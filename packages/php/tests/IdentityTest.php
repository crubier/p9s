<?php

declare(strict_types=1);

namespace P9s\Tests;

use Exception;
use InvalidArgumentException;
use P9s\Identity;
use P9s\P9s;
use PDOException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class IdentityTest extends TestCase
{
    public const CONFIG = [
        'engine' => [
            'users' => ['p9s_php_user'],
            'graphWriters' => ['p9s_php_writer'],
            'authentication' => ['getCurrentUserId' => 'current_role_id', 'setting' => 'app.user_id'],
        ],
        'tables' => [],
    ];

    public function testSettingsTakeTheFirstUserRoleAndTheSetting(): void
    {
        $users = new Identity(self::CONFIG);
        $this->assertSame('p9s_php_user', $users->role);
        $this->assertSame([['role', 'p9s_php_user'], ['app.user_id', '7']], $users->settings(7));
        $this->assertSame([['role', 'p9s_php_user'], ['app.user_id', '']], $users->settings(null));
        $this->assertSame(
            [['role', 'p9s_php_writer'], ['app.user_id', 'alice'], ['app.audit', 'on'], ['app.reason', '']],
            $users->settings('alice', role: 'p9s_php_writer', settings: ['app.audit' => true, 'app.reason' => null]),
        );
    }

    public function testTheStatementHasPlaceholders(): void
    {
        $this->assertSame(
            ['select set_config(?, ?, true), set_config(?, ?, true)', ['role', 'p9s_php_user', 'app.user_id', '7']],
            (new Identity(self::CONFIG))->statement(7),
        );
    }

    public function testAClaimSetsJsonClaims(): void
    {
        $config = ['engine' => ['users' => ['authenticated'], 'authentication' => ['setting' => 'request.jwt.claims', 'claim' => 'sub']]];
        $this->assertSame(['request.jwt.claims', '{"sub":"7"}'], (new Identity($config))->settings(7)[1]);
        $this->assertSame(['app.user_id', '7'], (new Identity($config, setting: 'app.user_id'))->settings(7)[1]);
    }

    public function testFromFile(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'p9s');
        file_put_contents($path, json_encode(self::CONFIG));
        try {
            $this->assertSame('app.user_id', Identity::fromFile($path)->setting);
        } finally {
            unlink($path);
        }
    }

    public function testRolesAndSettingsAreChecked(): void
    {
        $this->assertThrowsMessage('not a role', fn () => (new Identity(self::CONFIG))->settings(7, role: 'postgres'));
        $this->assertThrowsMessage('engine.users is empty', fn () => new Identity(['engine' => ['authentication' => ['setting' => 's']]]));
        $this->assertThrowsMessage('engine.authentication.setting', fn () => new Identity(['engine' => ['users' => ['app_user']]]));
    }

    public function testIsRefusedLooksThroughPreviousErrors(): void
    {
        $this->assertTrue(P9s::isRefused(self::postgresError('42501')));
        $this->assertTrue(P9s::isRefused(new RuntimeException('wrapped', 0, self::postgresError('42501'))));
        $this->assertFalse(P9s::isRefused(new RuntimeException('wrapped', 0, self::postgresError('23505'))));
        $this->assertFalse(P9s::isRefused(new Exception('nope')));
        $this->assertFalse(P9s::isRefused(null));
    }

    private static function postgresError(string $state): PDOException
    {
        $error = new PDOException("SQLSTATE[{$state}]");
        $error->errorInfo = [$state, 7, 'postgres'];

        return $error;
    }

    private function assertThrowsMessage(string $message, callable $callback): void
    {
        try {
            $callback();
        } catch (InvalidArgumentException $error) {
            $this->assertStringContainsString($message, $error->getMessage());

            return;
        }
        $this->fail("expected an error with {$message}");
    }
}
