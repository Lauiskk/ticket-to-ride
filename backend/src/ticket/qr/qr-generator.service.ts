import { Injectable, Logger } from '@nestjs/common';

/**
 * QR code image generator (Req 9.3).
 *
 * - PNG preferred as primary format
 * - JPEG as fallback if PNG generation fails
 * - Minimum 300x300 pixels
 * - Returns base64 data URL and format
 */
@Injectable()
export class QrGeneratorService {
  private readonly logger = new Logger(QrGeneratorService.name);

  /**
   * Generate a QR code image from a payload string.
   * Returns base64 data URL and the format used.
   */
  async generate(payload: string): Promise<{ dataUrl: string; format: string }> {
    try {
      // Try PNG first (preferred)
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(payload, {
        type: 'image/png',
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      return { dataUrl, format: 'png' };
    } catch (pngError) {
      this.logger.warn(`PNG QR generation failed, trying JPEG fallback: ${pngError instanceof Error ? pngError.message : 'unknown'}`);

      try {
        // JPEG fallback (Req 9.3)
        const QRCode = await import('qrcode');
        const dataUrl = await QRCode.toDataURL(payload, {
          type: 'image/jpeg' as any,
          width: 300,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
        return { dataUrl, format: 'jpeg' };
      } catch (jpegError) {
        this.logger.error(`Both PNG and JPEG QR generation failed`);
        throw pngError; // Re-throw original error
      }
    }
  }
}
