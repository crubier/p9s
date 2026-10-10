<?php

declare(strict_types=1);

namespace P9s;

use InvalidArgumentException;

/**
 * What a transaction needs to act as an application user: the database role the policies are for, and the setting the
 * current user function of the migration reads, from engine.authentication of the config of p9s. Both are set with
 * set_config(..., true), so that they end with the transaction, and a pooled connection never keeps the identity of a
 * previous request.
 */
final class Identity
{
    public readonly string $role;

    public readonly string $setting;

    /** The claim of the setting, when it holds JSON claims, like request.jwt.claims of PostgREST */
    public readonly ?string $claim;

    /** @var list<string> */
    public readonly array $roles;

    /**
     * @param  array<string, mixed>  $config  the config of p9s, as p9s.config.json holds it
     * @param  string|null  $setting  the setting the current user function reads, instead of the one of the config
     * @param  string|null  $claim  the claim of the setting, instead of the one of the config
     */
    public function __construct(array $config, ?string $setting = null, ?string $claim = null)
    {
        $engine = is_array($config['engine'] ?? null) ? $config['engine'] : [];
        $authentication = is_array($engine['authentication'] ?? null) ? $engine['authentication'] : [];
        $users = array_values(array_map('strval', (array) ($engine['users'] ?? [])));
        if ($users === []) {
            throw new InvalidArgumentException('p9s: engine.users is empty');
        }

        $this->setting = $setting ?? (string) ($authentication['setting'] ?? '');
        if ($this->setting === '') {
            throw new InvalidArgumentException(
                'p9s: set engine.authentication.setting, like "app.user_id", for the migration to read the current '
                .'user from it, or pass the setting the current user function reads',
            );
        }
        $this->claim = $claim === null && $setting === null ? ($authentication['claim'] ?? null) : $claim;
        $this->role = $users[0];
        $writers = array_map('strval', (array) ($engine['graphWriters'] ?? []));
        $this->roles = array_values(array_unique([...$users, ...$writers]));
    }

    public static function fromFile(string $path, ?string $setting = null, ?string $claim = null): self
    {
        $json = @file_get_contents($path);
        if ($json === false) {
            throw new InvalidArgumentException("p9s: cannot read {$path}");
        }

        return new self(json_decode($json, true, flags: JSON_THROW_ON_ERROR), $setting, $claim);
    }

    /** The value of the setting for a user: their id as text, or JSON claims. No user reads as no one. */
    public function value(int|string|null $userId): string
    {
        if ($userId === null) {
            return '';
        }

        return $this->claim === null
            ? (string) $userId
            : json_encode([$this->claim => (string) $userId], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    /**
     * The settings of a transaction of the user, as [name, value] pairs, the role first, with transaction_read_only for
     * a read only transaction, which Postgres takes even after the transaction has run a statement
     *
     * @param  array<string, scalar|null>  $settings  more settings for the transaction
     * @return list<array{string, string}>
     */
    public function settings(int|string|null $userId, ?string $role = null, array $settings = [], bool $readOnly = false): array
    {
        $chosen = $role ?? $this->role;
        if (! in_array($chosen, $this->roles, true)) {
            throw new InvalidArgumentException("p9s: {$chosen} is not a role of engine.users or engine.graphWriters");
        }

        $pairs = [['role', $chosen], [$this->setting, $this->value($userId)]];
        foreach ($settings as $name => $value) {
            $pairs[] = [(string) $name, self::text($value)];
        }
        if ($readOnly) {
            $pairs[] = ['transaction_read_only', 'on'];
        }

        return $pairs;
    }

    /**
     * The statement to run first in a transaction, with ? placeholders: ['select set_config(?, ?, true), ...', values]
     *
     * @param  array<string, scalar|null>  $settings
     * @return array{string, list<string>}
     */
    public function statement(int|string|null $userId, ?string $role = null, array $settings = [], bool $readOnly = false): array
    {
        $pairs = $this->settings($userId, $role, $settings, $readOnly);
        $calls = implode(', ', array_fill(0, count($pairs), 'set_config(?, ?, true)'));

        return ["select {$calls}", array_merge(...$pairs)];
    }

    private static function text(mixed $value): string
    {
        return match (true) {
            $value === null => '',
            $value === true => 'on',
            $value === false => 'off',
            default => (string) $value,
        };
    }
}
