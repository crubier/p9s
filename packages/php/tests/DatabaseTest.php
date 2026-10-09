<?php

declare(strict_types=1);

namespace P9s\Tests;

use Illuminate\Container\Container;
use Illuminate\Database\Capsule\Manager;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use P9s\AsUser;
use P9s\Identity;
use P9s\P9s;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class DatabaseTest extends TestCase
{
    private static bool $prepared = false;

    private ConnectionInterface $db;

    protected function setUp(): void
    {
        $url = getenv('P9S_TEST_DATABASE_URL');
        if (! is_string($url) || $url === '') {
            $this->markTestSkipped('P9S_TEST_DATABASE_URL is not set');
        }

        $container = new Container;
        Container::setInstance($container);
        $capsule = new Manager($container);
        $capsule->addConnection(['driver' => 'pgsql', 'url' => $url]);
        $container->instance('db', $capsule->getDatabaseManager());
        $this->db = $capsule->getConnection();
        P9s::useIdentity(new Identity(IdentityTest::CONFIG));
        P9s::resolveUserIdUsing(fn (Request $request) => $request->header('x-user-id'));

        if (! self::$prepared) {
            $this->db->unprepared(<<<'SQL'
                do $$
                begin
                  if not exists (select from pg_roles where rolname = 'p9s_php_user') then create role p9s_php_user nologin; end if;
                  if not exists (select from pg_roles where rolname = 'p9s_php_writer') then create role p9s_php_writer nologin; end if;
                end
                $$;
                grant p9s_php_user, p9s_php_writer to current_user;
                drop table if exists p9s_php_note;
                create table p9s_php_note (id serial primary key, body text not null);
                grant select on p9s_php_note to p9s_php_user;
                grant select, insert on p9s_php_note to p9s_php_writer;
                grant usage on sequence p9s_php_note_id_seq to p9s_php_writer;
                SQL);
            self::$prepared = true;
        }
    }

    protected function tearDown(): void
    {
        P9s::useIdentity(null);
        P9s::resolveUserIdUsing(null);
        Container::setInstance(null);
    }

    public function testAsUser(): void
    {
        $this->assertSame(['p9s_php_user', '7'], P9s::asUser(7, fn () => $this->who()));
        $this->assertNotSame('p9s_php_user', $this->who()[0]);
    }

    public function testReadOnly(): void
    {
        try {
            P9s::asUser(7, fn () => $this->db->insert("insert into p9s_php_note (body) values ('read only')"), readOnly: true, role: 'p9s_php_writer');
            $this->fail('expected a read only transaction');
        } catch (QueryException $error) {
            $this->assertStringContainsString('read-only transaction', $error->getMessage());
        }
    }

    public function testARefusedWriteIsRefused(): void
    {
        try {
            P9s::asUser(7, fn () => $this->db->insert("insert into p9s_php_note (body) values ('refused')"));
            $this->fail('expected a refused write');
        } catch (QueryException $error) {
            $this->assertTrue(P9s::isRefused($error));
        }
    }

    public function testARolledBackTransactionLeavesNothingOnTheConnection(): void
    {
        try {
            P9s::asUser(7, fn () => throw new RuntimeException('rolled back'));
        } catch (RuntimeException) {
        }
        [$role, $user] = $this->who();
        $this->assertNotSame('p9s_php_user', $role);
        $this->assertContains($user, [null, '']);
    }

    public function testTheMiddlewareActsAsTheUserOfTheRequest(): void
    {
        $request = Request::create('/notes', 'GET', server: ['HTTP_X_USER_ID' => '42']);
        $response = (new AsUser)->handle($request, fn () => new JsonResponse($this->who()));
        $this->assertSame(['p9s_php_user', '42'], $response->getData(true));
        $this->assertNotSame('p9s_php_user', $this->who()[0]);
    }

    public function testTheMiddlewareRollsBackAResponseOfAnError(): void
    {
        $request = Request::create('/notes', 'POST', server: ['HTTP_X_USER_ID' => '42']);
        $before = $this->notes();
        $response = (new AsUser)->handle($request, function () {
            $this->db->select("select set_config('role', 'p9s_php_writer', true)");
            $this->db->insert("insert into p9s_php_note (body) values ('rolled back')");

            return (new JsonResponse(['error' => 'oops'], 500))->withException(new RuntimeException('oops'));
        });
        $this->assertSame(500, $response->getStatusCode());
        $this->assertSame($before, $this->notes());
    }

    /** @return array{string, string|null} */
    private function who(): array
    {
        $row = $this->db->selectOne("select current_user as role, current_setting('app.user_id', true) as user_id");

        return [$row->role, $row->user_id];
    }

    private function notes(): int
    {
        return (int) $this->db->scalar('select count(*) from p9s_php_note');
    }
}
