import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '../../user/entities/user.entity';

/**
 * Cadastro, validado inteiramente no servidor. O papel é enum fechado: sem
 * isso, `role` vira campo de escolha livre e qualquer um se cadastra como
 * organizador.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Formato de email inválido' })
  @MaxLength(254, { message: 'Email deve ter no máximo 254 caracteres' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  @MaxLength(100, { message: 'Senha deve ter no máximo 100 caracteres' })
  @Matches(/[A-Z]/, { message: 'Senha deve conter pelo menos uma letra maiúscula' })
  @Matches(/[a-z]/, { message: 'Senha deve conter pelo menos uma letra minúscula' })
  @Matches(/[0-9]/, { message: 'Senha deve conter pelo menos um número' })
  @Matches(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/, { message: 'Senha deve conter pelo menos um caractere especial' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  @MaxLength(100, { message: 'Nome deve ter no máximo 100 caracteres' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/<[^>]*>/g, '') : value)
  name: string;

  @IsEnum(UserRole, { message: 'Papel inválido. Valores permitidos: organizer, client' })
  role: UserRole;
}
