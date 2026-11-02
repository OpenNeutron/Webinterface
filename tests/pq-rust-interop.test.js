// A copy sealed by the Rust server must open in the browser.
//
// Both implementations derive the message key with HKDF over the two shared secrets and
// a SHA-256 digest of the label and both ciphertexts. Two implementations that merely
// agree with themselves agree with nothing, so this vector was produced by
// `cargo test print_interop_vector -- --ignored --nocapture` in src/core/pqkeys.rs and is
// checked here with the browser's own decrypt path. Regenerate it if the combiner changes.
//
// The key material below is a throwaway generated for this vector — it seals nothing.

import { describe, it, expect, beforeAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { decryptEmailBytes } from '@/crypto'

const VECTOR = {
  rsa_private_der: 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCw5v/b82FmxubTW5bs6y1DcDJJxfvHoEoOUeS66f1ewTMquiW6uSqE9XTyahB4N0H1mJbRtBigTQ8XVxFCqrymPGVnq+jN4K5d7oo7HROaYsw10ZsiOeMGUsOYqOLE4CwueB5yrVSBONF8LLyoAeVyIOwcpxKL1tMzirIU+UlgCuxC0CN9j2z41Zjrs+9kmkL7RS4+6xfc7iPXdEbpZirzWa1O8/IzBQZGdwp9ccoq8p2Ietkt91tNRVquFQ/a3fHHPyW3nFGDlW8oifIy+eBtbwjsbZgbRxHXVmjG1qYdzJfvzgn3tpaoedVMwMmtFVIU24mJqPXZzgPJl9Wp38/7AgMBAAECggEAKV0aHnf+ImYHuwwDckpbPxWQ7KcahEb6ifakIQBteiZ6rFbyU4LQal5qhfQ+/Z0OEzsmqMoPqAvcp3x4ULpTehtNKryLpvgOTXBlagUWfFb1oO/t8kbOyr+3dI6o15gDPKphlDbrN3vtn7dmNXKcD9+a1ehK8d+9aqPXmAfiHE6N1wg7jBleWJqRh6ZPMBuzu0b9IDIaq83YeXBMLIC7kzA1lgfHtXwjN4X7SDp3LczTyWnwtkY3Skhr3GcQhNjQhMUUJ6wuX5V3jLEl/9sMoqfxXIykjYfORmUXJxDdUPBwVv41ip7RVW67AKo+qMtZDkTAsHQJPQ2n40ZR00qEYQKBgQDIsCCWzvE4fOZwlakss8RSQVILAWE6jRS9u8stG/vOIYsw3oj9EWCSeOup8O4HpCEIX7YJhVJ9TgpP0yElzB1BPRiE//GPGdMEYDweoLFhuOCKcfMPyhGk2jjgY6yTumpSJQ9xFs9K6Is8dF2bTxDNiNJk95xZtcBDzGkj0cpu1wKBgQDhqKLPXb8bqOQYmHeRd+u6NzKuC8SfAC/uLBYQCGfBUrZZljeKmA5J6Q48sdb2+n1b2rC6if1y3vW1+dfVRu3Fw1Mu+L9Oi6Q6O5AA3F9oOWRC7j/6FLpGD5G2bQ3MmDY293k5xm97hjIU0AOAYB9ZjXnB61Aj1zm0Nmm/hBS3fQKBgQCgylyR96PU+l02/vHYWv+EV8l//88Ctl5T1c5nifApqz52HRXsjKuvLyrBscNEZAADUYvr/OGme4xPgH0iZ3NY/bZTeSz01l/3NZN1hpIYFaPxyHJRyDhyuFSxk6qFgeoFfqPsm7Xh8ob8HM+Sy7pOsry/IJQoXDJ7H59tj3x9aQKBgQCCk9WaTvH+LG3I+bj+uTjzqWsvIWomY7JYjLQ7lNGNIbKZBn6fOTvTcwOlBXeRtQMDOvnXB3Bcnz3pjmhhZsjCDjO9U31IEy/17m92wA6JPeSRglINAR+E2Q+FU3ePs2hzyCIi13u9K7shJflQuM6LQH17RBI8mxct++qXQvPF9QKBgA3Clf5fcWCcuAXhVIMQbeaiKAfqqdH5lSSkHsPyqibxzTE8oHU7IvA0yMU7kljJoH2W3Lq0RWdEhtT/+/4ru/2KQ2bmamqDeovdk1iaQBPcs8imy8uLXnAkkw53zfG7T0SDVtMDkVpKJtFeAjPOj7f2/GMGkmcEtS5TgsBIYZSU',
  mlkem_secret: 'ZBO0Bx/Qd8nDnejzI5f0lAqnW/46VcNtc1PTs4OWZ5RGGdLabeFa7pm8OnWJCiJp+J9/xHNHtF5rAGOhIq0UeA==',
  envelope: 'U0xRAgEAihDkMy61LyrJkOd3Z5cyMVxew7CyRfFLeDAo72FDJVKA4FV5FdNVnYh3tRHaw0S6qAFMk1IrMwbJkZ6AWq9Ae/SlmNN65SwKC+j1RoUpaw7NaNGNclz4vtFPjOZZcYtXrSXeD/YPphZONl9x95Wj1rXXq/5TpZ7yJ33n4rzsMz2eFZZHc4tffLdvA4vW0gGeWoVARfNUAeEGWKp4RX0QBc6xTJzTpFGIpYzfnZDADYQvj1/qHc1h5AMot+2eg0+Jsh8fNSPMcGLNxevLHCzDS9nY4U7oKnU9+PE3xhm8WQ7QaDwYDMcA/Um1N3NIi/B/gMZlEaG/BNO6txr/IxOuRWgIG9Irsp5/UnLC1N3IZleJMiN2wZQ8fk+qDmmN0X10y18Q/+gV45CLkTP1/obDBhk9I5y0YGqEigpq0YlsRAGSUn3fabcAi7vWNOPatG3fzqSDZY3JmzKi/uFZSQjN/MZBy4/NZzQhbxOE41s5yWiRU4YG6FitLE95SkstwAnhwcBKcHDikVWmbePQJv4w60EJb1sv8SuQdxcjqO6TO6uj6EU3/kKFjD9I0ep8H3Q7cB0XOJ4LCPzAN98UWdKVgrklFDV1S+sIkbKLFP9LmjW0e31waLsk4SOW99Q3aqjgLbwu4Ny0dhig00o6YHPVnSH4gpkL9WzvR9Abc9gvJbqUsqynrYOhZnERb6FHRT2e/LdgmOHfgXQfoVmXc37W/JmPqZNHfQ88ZT1KybTlEr/xzLoQCnZ7Q3BIwSujlZrMBBFwpdH+Wz3pvK9nRSDQOE7FlU8ZoePtwN6o9TSAZzZaINnXAIGUSHC8jVOgl2jrjXgfDILdL3CFwf3bWujfgDod8J535Igf/ymaCx88bmlsIuws/qhzCKoCPtM2wWYaW9KNEX3lZURHS0uuZsZEX/CeUdxv/Pi3VeEZE+HP1oziCNkOQzgxIGc37HLW2PDvOav6b0r7iUFIOWd1GyNbdnSl7kLqt7ADs4oH60BakAJEK7YPzfDcEUpFiX8p21FzXU7FBvjHt2MmhQeTezcotKP9lq3H7h+Y+86Zvx/7SZwfPMnu/Mmv6ZAyFeDO4PPyIXpz7r51cafmmv6rcOmVAXBQgMpr2ldvDtxP+4W0Ad9LcYXtY/zpubEHOxtMWMp3ejP925q7/FTXcxxH8gAv3vtzRSlr1MThJBlIAChzOBLeM8QgLuvyzT4PYqL8S1Z9R7OaJuZyFe9TCOeZSfd/9fX7vkS3HZdk9tQwBnL6LkRRa5AHsaUMsNuPY2t61vjiqUdb01YFt0nmG/BagOt1CeqqmFo6aka8qkiq4LS881m+2L6tqw43aV1wkWj7QDcSNi8HcfTFLe1sS6cD5MzCINdBADswOSoJItL+E/fkfr6KjHXzJSGiYhFFYaosP+ukZt+Ilw8qSQGEOdttHtz4+toa1Hxw2yfAjF4ck0Kg425bmFAxq3o+en5BNdyeM6sq2+Z8QguH8qCNrtqHTsLaxXKCico9Y20wN4Mft+v4qsG09l4teTM2Fopxl2kMd1SORmoPP3ck1f2NtQ7141zGv1WyHuuUxMQLotlL2a3HC2bmRwk0jyEmU9ibqYdmG9p9GuU4CK3xurv7dvIJdJ3P+/EpBGztnKcX6yUQ9X/7v5MBDr6y1XXcT5YE1/fWHAoXFTXSrLGcKztLPytyvrN6udkDDeXESQUFuvMOEAwktcg/AcJfJynZjQRnrPSycSirCMKAxKx/GzDrWeTXhW8So0ocBfWhLlpHlgbBQtjfsDaJjV3RkB7U0VI9Zk9g5ShG',
  data: 'Uz45Y9XwXQ0MBFNx2QtwIluzPtHhwXl/B2rOXitsnee61mtBmP5oKzw=',
}

const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

describe('a copy the Rust server sealed', () => {
  let privateKey

  beforeAll(async () => {
    globalThis.crypto ??= webcrypto
    if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle })
    privateKey = await webcrypto.subtle.importKey(
      'pkcs8',
      fromB64(VECTOR.rsa_private_der),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    )
  })

  it('opens in the browser with both halves', async () => {
    // Rust hands over the 64-byte FIPS 203 seed; the browser expands it into the
    // 2400-byte decapsulation key. Expanding it here is also the check that both
    // sides agree on which key the ciphertext was made for.
    const secretKey = ml_kem768.keygen(fromB64(VECTOR.mlkem_secret)).secretKey
    const opened = await decryptEmailBytes(
      VECTOR.data,
      VECTOR.envelope,
      privateKey,
      secretKey,
      'bob',
    )
    expect(new TextDecoder().decode(opened)).toBe('interop check')
  })

  it('is version 2, the only version this build writes', () => {
    expect(fromB64(VECTOR.envelope).subarray(0, 4)).toEqual(new Uint8Array([0x53, 0x4c, 0x51, 0x02]))
  })
})
