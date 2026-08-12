import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

// passport-google-oauth20 types
interface GoogleProfile {
  id: string;
  emails: Array<{ value: string; verified: boolean }>;
  name: { givenName: string; familyName: string };
  photos: Array<{ value: string }>;
}

type DoneCallback = (err: any, user?: any, info?: any) => void;

/**
 * Google OAuth2 Strategy.
 *
 * Flow:
 * 1. User clicks "Login com Google" → redirected to Google
 * 2. Google authenticates → redirects back to /auth/google/callback
 * 3. validate() receives profile → returns user data to controller
 *
 * If the email already exists with password auth, the controller
 * will show "Este email já tem conta" instead of creating a new one.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(
  require('passport-google-oauth20').Strategy,
  'google',
) {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: DoneCallback,
  ): void {
    const user = {
      email: profile.emails[0].value,
      name: `${profile.name.givenName} ${profile.name.familyName}`,
      picture: profile.photos?.[0]?.value || null,
      oauthProvider: 'google',
      oauthId: profile.id,
    };
    done(null, user);
  }
}
