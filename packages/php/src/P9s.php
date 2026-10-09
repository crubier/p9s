<?php

declare(strict_types=1);

namespace P9s;

use Closure;
use Illuminate\Container\Container;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\Request;
use Throwable;

/**
 * Act as a user of p9s from Laravel: P9s::asUser($userId, fn () => ...) runs a closure in a transaction as the user,
 * and the AsUser middleware every request.
 */
final class P9s
{
    public const INSUFFICIENT_PRIVILEGE = '42501';

    private static ?Identity $identity = null;

    /** @var (Closure(Request): (int|string|null))|null */
    private static ?Closure $userIdResolver = null;

    /** The identity of p9s.config.json: the one P9S_CONFIG names, or the one at the root of the Laravel app */
    public static function identity(): Identity
    {
        return self::$identity ??= Identity::fromFile(self::configPath());
    }

    public static function useIdentity(?Identity $identity): void
    {
        self::$identity = $identity;
    }

    /**
     * Runs the closure in a transaction as the user: every query of the connection goes through the policies, it
     * commits when the closure returns, and rolls back when it throws. Inside a transaction already, acts as the user
     * until it ends.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @param  array<string, scalar|null>  $settings  more settings for the transaction
     * @return T
     */
    public static function asUser(
        int|string|null $userId,
        Closure $callback,
        bool $readOnly = false,
        ?string $role = null,
        array $settings = [],
        ConnectionInterface|string|null $connection = null,
        ?Identity $identity = null,
    ): mixed {
        $database = self::connection($connection);

        return $database->transaction(function () use ($userId, $callback, $readOnly, $role, $settings, $database, $identity) {
            self::setUser($userId, $readOnly, $role, $settings, $database, $identity);

            return $callback();
        });
    }

    /**
     * Acts as the user for the rest of the current transaction
     *
     * @param  array<string, scalar|null>  $settings
     */
    public static function setUser(
        int|string|null $userId,
        bool $readOnly = false,
        ?string $role = null,
        array $settings = [],
        ConnectionInterface|string|null $connection = null,
        ?Identity $identity = null,
    ): void {
        $database = self::connection($connection);
        if ($readOnly) {
            $database->statement('set transaction read only');
        }
        [$sql, $values] = ($identity ?? self::identity())->statement($userId, $role, $settings);
        $database->select($sql, $values);
    }

    /**
     * Whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a row the
     * policies do not let through, a statement the role has no privilege for, or a share of bits the user does not
     * have. Laravel wraps the PDOException in an Illuminate\Database\QueryException.
     */
    public static function isRefused(?Throwable $error): bool
    {
        for ($depth = 0; $error !== null && $depth < 8; $depth++, $error = $error->getPrevious()) {
            $state = property_exists($error, 'errorInfo') && is_array($error->errorInfo) ? ($error->errorInfo[0] ?? null) : null;
            if ((string) ($state ?? $error->getCode()) === self::INSUFFICIENT_PRIVILEGE) {
                return true;
            }
        }

        return false;
    }

    /**
     * How the AsUser middleware finds the user of a request, by default $request->user()?->getAuthIdentifier()
     *
     * @param  (Closure(Request): (int|string|null))|null  $resolver
     */
    public static function resolveUserIdUsing(?Closure $resolver): void
    {
        self::$userIdResolver = $resolver;
    }

    public static function userIdOf(Request $request): int|string|null
    {
        if (self::$userIdResolver !== null) {
            return (self::$userIdResolver)($request);
        }

        return $request->user()?->getAuthIdentifier();
    }

    public static function connection(ConnectionInterface|string|null $connection = null): ConnectionInterface
    {
        if ($connection instanceof ConnectionInterface) {
            return $connection;
        }

        return Container::getInstance()->make('db')->connection($connection);
    }

    private static function configPath(): string
    {
        $path = getenv('P9S_CONFIG');
        if (is_string($path) && $path !== '') {
            return $path;
        }

        return function_exists('base_path') && Container::getInstance()->bound('path.base')
            ? base_path('p9s.config.json')
            : 'p9s.config.json';
    }
}
