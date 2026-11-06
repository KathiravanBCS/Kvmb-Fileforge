import { registerAs } from '@nestjs/config';

import { decodeEncryptionKey, validateEnv } from './env.validation';

export default registerAs('centralStorage', () => {
  const env = validateEnv(process.env);
  return {
    // validateEnv already proved the key decodes to exactly 32 bytes.
    encryptionKey: decodeEncryptionKey(env.CENTRAL_STORAGE_ENCRYPTION_KEY) as Buffer,
    keyVersion: env.CENTRAL_STORAGE_ENCRYPTION_KEY_VERSION,
  };
});
