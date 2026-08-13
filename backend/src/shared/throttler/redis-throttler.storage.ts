import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';

const PREFIX = 'throttle:';

/** O `ThrottlerStorageRecord` do pacote não é reexportado no índice público. */
interface Registro {
  totalHits: number;
  timeToExpire: number;
}

/**
 * Contagem do limitador no Redis, e não na memória do processo.
 *
 * O armazenamento padrão do `@nestjs/throttler` é um objeto em memória. Com uma
 * réplica só isso funciona; com duas, cada uma conta a sua parte, e um teto de
 * 120 por minuto vira 240 sem ninguém perceber — o limite passa a depender de
 * quantas cópias da API estão no ar, que é justamente o número que a plataforma
 * muda sozinha.
 *
 * Redis fora do ar **não** desliga o limitador: a contagem volta para a memória
 * do processo, que é pior mas não é nada. Mesma postura da blacklist de tokens e
 * do limitador de login — degradar, nunca cair.
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly emMemoria = new ThrottlerStorageService();
  private redis: Redis | null = null;
  /** Para o aviso de degradação sair uma vez, não a cada requisição. */
  private jaAvisou = false;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('redis.url');
    if (!redisUrl) {
      this.logger.warn('Redis não configurado — limite de requisições fica por processo');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 2000)),
        lazyConnect: true,
      });
      this.redis.connect().catch(() => this.degradar('conexão recusada'));
    } catch {
      this.degradar('cliente não pôde ser criado');
    }
  }

  /** `ttl` chega em milissegundos; `timeToExpire` sai em segundos. */
  async increment(key: string, ttl: number): Promise<Registro> {
    if (!this.redis) return this.emMemoria.increment(key, ttl);

    try {
      const chave = `${PREFIX}${key}`;

      const resultado = await this.redis.multi().incr(chave).pttl(chave).exec();
      if (!resultado) throw new Error('pipeline sem resultado');

      const totalHits = Number(resultado[0][1]);
      let restanteMs = Number(resultado[1][1]);

      // Chave recém-criada não tem expiração: sem isto ela vive para sempre e o
      // primeiro minuto de uso bloqueia o cliente pelo resto do dia.
      if (restanteMs < 0) {
        await this.redis.pexpire(chave, ttl);
        restanteMs = ttl;
      }

      return { totalHits, timeToExpire: Math.ceil(restanteMs / 1000) };
    } catch (error) {
      this.degradar(error instanceof Error ? error.message : String(error));
      return this.emMemoria.increment(key, ttl);
    }
  }

  private degradar(motivo: string): void {
    if (this.jaAvisou) return;
    this.jaAvisou = true;
    this.logger.warn(`RATE_LIMIT_DEGRADED — contando em memória (${motivo})`);
  }

  onApplicationShutdown(): void {
    this.emMemoria.onApplicationShutdown();
    this.redis?.disconnect();
  }
}
