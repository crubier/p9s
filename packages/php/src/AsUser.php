<?php

declare(strict_types=1);

namespace P9s;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Runs the rest of the request in a transaction as its user, read only for GET and HEAD. Laravel turns an exception of
 * a controller into a response before it reaches the middleware, so a response that holds an exception rolls back
 * too. Put it after the middleware that authenticates the user.
 */
final class AsUser
{
    /** @param  Closure(Request): Response  $next */
    public function handle(Request $request, Closure $next, ?string $connection = null): Response
    {
        $database = P9s::connection($connection);
        $database->beginTransaction();
        try {
            P9s::setUser(P9s::userIdOf($request), readOnly: $request->isMethodSafe(), connection: $database);
            $response = $next($request);
        } catch (Throwable $error) {
            $database->rollBack();
            throw $error;
        }

        if (($response->exception ?? null) instanceof Throwable) {
            $database->rollBack();
        } else {
            $database->commit();
        }

        return $response;
    }
}
