<?php

declare(strict_types=1);

namespace P9s\Tests;

use Illuminate\Container\Container;
use Illuminate\Database\Capsule\Manager;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use P9s\Identity;
use P9s\P9s;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/** The conformance suite of p9s, see packages/conformance */
final class ConformanceTest extends TestCase
{
    private const SUITE = __DIR__.'/../../conformance';

    /** @var array<string, mixed> */
    private array $cases;

    private Identity $users;

    private ConnectionInterface $db;

    protected function setUp(): void
    {
        $url = getenv('P9S_CONFORMANCE_DATABASE_URL');
        if (! is_string($url) || $url === '') {
            $this->markTestSkipped('P9S_CONFORMANCE_DATABASE_URL is not set');
        }

        $this->cases = json_decode((string) file_get_contents(self::SUITE.'/cases.json'), true, flags: JSON_THROW_ON_ERROR);
        $this->users = Identity::fromFile(self::SUITE.'/'.$this->cases['config']);
        $container = new Container;
        Container::setInstance($container);
        $capsule = new Manager($container);
        $capsule->addConnection(['driver' => 'pgsql', 'url' => $url], 'conformance');
        $container->instance('db', $capsule->getDatabaseManager());
        $this->db = $capsule->getConnection('conformance');
    }

    protected function tearDown(): void
    {
        Container::setInstance(null);
    }

    private function asUser(int|string|null $userId, \Closure $callback, bool $readOnly = false): mixed
    {
        return P9s::asUser($userId, $callback, readOnly: $readOnly, connection: $this->db, identity: $this->users);
    }

    /** @return list<list<mixed>> */
    private function rows(string $sql): array
    {
        return array_map(fn (object $row) => array_values((array) $row), $this->db->select($sql));
    }

    public function testTheRoleAndTheSettingComeFromTheConfig(): void
    {
        $this->assertSame([$this->cases['role'], $this->cases['setting']], [$this->users->role, $this->users->setting]);
    }

    public function testEachUserReadsTheirRowsOnOneConnectionInTurns(): void
    {
        foreach ([1, 2] as $_) {
            foreach ($this->cases['reads'] as ['user' => $user, 'ids' => $ids]) {
                $read = $this->asUser($user, fn () => array_column($this->rows($this->cases['read']), 0), readOnly: true);
                $this->assertSame($ids, $read);
            }
        }
    }

    public function testInsertReturningWorks(): void
    {
        ['user' => $user, 'sql' => $sql, 'folderId' => $folderId] = $this->cases['insert'];
        [[$id, $folder]] = $this->asUser($user, fn () => $this->rows($sql));
        $this->assertSame($folderId, $folder);
        $this->assertGreaterThan(3, $id);
    }

    public function testARefusedWriteIsAnError(): void
    {
        ['user' => $user, 'sql' => $sql] = $this->cases['refused'];
        try {
            $this->asUser($user, fn () => $this->db->statement($sql));
            $this->fail('expected a refused write');
        } catch (QueryException $error) {
            $this->assertTrue(P9s::isRefused($error));
        }
    }

    public function testARolledBackTransactionLeavesNothingOnTheConnection(): void
    {
        $user = $this->cases['whoUser'];
        $inside = null;
        try {
            $this->asUser($user, function () use (&$inside) {
                $inside = $this->rows($this->cases['who'])[0];
                throw new RuntimeException('rolled back');
            });
        } catch (RuntimeException) {
        }
        $this->assertSame([$this->cases['role'], (string) $user], $inside);
        [[$role, $userId]] = $this->rows($this->cases['who']);
        $this->assertNotSame($this->cases['role'], $role);
        $this->assertSame('', $userId);
    }
}
