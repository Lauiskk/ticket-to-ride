import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { validate, ValidationError as CVError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AppError, ErrorCodes, type ValidationErrorDetail } from '../errors';

/**
 * Custom validation pipe that integrates with our AppError system.
 *
 * Uses class-validator to validate incoming DTOs and transforms
 * validation failures into our standardized format:
 * - 400 VALIDATION_ERROR with field-level error details
 * - 400 PARSING_ERROR when the body cannot be parsed
 *
 * Registered globally in main.ts.
 */
@Injectable()
export class AppValidationPipe implements PipeTransform {
  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const { metatype } = metadata;

    // Skip validation for types that don't need it
    if (!metatype || !this.shouldValidate(metatype)) {
      return value;
    }

    // Handle null/undefined body
    if (value === null || value === undefined) {
      throw new AppError(
        'Request body is required',
        ErrorCodes.PARSING_ERROR,
        400,
      );
    }

    // Transform plain object to class instance
    const object = plainToInstance(metatype, value);

    // Validate
    const errors = await validate(object as object, {
      whitelist: true,           // Strip unknown properties
      forbidNonWhitelisted: true, // Throw on unknown properties
      skipMissingProperties: false,
    });

    if (errors.length > 0) {
      const validationErrors = this.flattenErrors(errors);
      throw new AppError(
        'Validation failed',
        ErrorCodes.VALIDATION_ERROR,
        400,
        validationErrors,
      );
    }

    return object;
  }

  /**
   * Determine if the metatype requires validation.
   * Skip native JS types.
   */
  private shouldValidate(metatype: new (...args: unknown[]) => unknown): boolean {
    const nativeTypes: Array<new (...args: unknown[]) => unknown> = [
      String,
      Boolean,
      Number,
      Array,
      Object,
    ];
    return !nativeTypes.includes(metatype);
  }

  /**
   * Recursively flatten class-validator errors into our ValidationErrorDetail format.
   * Handles nested objects (e.g., address.city).
   */
  private flattenErrors(
    errors: CVError[],
    parentPath = '',
  ): ValidationErrorDetail[] {
    const result: ValidationErrorDetail[] = [];

    for (const error of errors) {
      const fieldPath = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

      // Direct constraints on this field
      if (error.constraints) {
        const constraintEntries = Object.entries(error.constraints);
        for (const [code, message] of constraintEntries) {
          result.push({
            field: fieldPath,
            message,
            code: code.toUpperCase(),
          });
        }
      }

      // Nested object validation errors
      if (error.children && error.children.length > 0) {
        const nested = this.flattenErrors(error.children, fieldPath);
        result.push(...nested);
      }
    }

    return result;
  }
}
