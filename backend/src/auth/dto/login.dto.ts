import { IsEmail, IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Login DTO with server-side validation.
 *
 * Security:
 * - Email: trimmed, lowercased, validated format, max 254
 * - Password: required, min 1, max 100 (prevent mega-payload DoS)
 */
export class LoginDto {
  @IsEmail({}, { message: 'Formato de email inválido' })
  @MaxLength(254, { message: 'Email deve ter no máximo 254 caracteres' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  @MinLength(1, { message: 'Senha é obrigatória' })
  @MaxLength(100, { message: 'Senha deve ter no máximo 100 caracteres' })
  password: string;
}
