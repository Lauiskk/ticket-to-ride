/**
 * Standalone seed runner.
 * Usage: npm run seed
 *
 * This script bootstraps the NestJS application context
 * (without starting the HTTP server) and runs the seed service.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SeedService } from './seed.service';

async function runSeed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const seedService = app.get(SeedService);
  await seedService.run();

  await app.close();
  process.exit(0);
}

runSeed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
