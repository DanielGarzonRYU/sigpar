<?php
/**
 * JWT HS256 mínimo (sin dependencias externas).
 */
final class Jwt
{
    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function unb64(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }

    public static function encode(array $payload, string $secret): string
    {
        $header = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body   = self::b64(json_encode($payload));
        $sig    = self::b64(hash_hmac('sha256', "$header.$body", $secret, true));
        return "$header.$body.$sig";
    }

    public static function decode(string $token, string $secret): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;
        [$header, $body, $sig] = $parts;

        $expected = self::b64(hash_hmac('sha256', "$header.$body", $secret, true));
        if (!hash_equals($expected, $sig)) return null;

        $payload = json_decode(self::unb64($body), true);
        if (!is_array($payload)) return null;
        if (isset($payload['exp']) && time() >= $payload['exp']) return null;
        return $payload;
    }
}
