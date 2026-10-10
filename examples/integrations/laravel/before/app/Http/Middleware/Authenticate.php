<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** A real app signs users in, with a session or a token, this one reads the user from a header */
class Authenticate
{
    public function handle(Request $request, Closure $next): Response
    {
        $header = (string) $request->header('x-user-id');
        if (! preg_match('/^-?\d+$/', $header)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        $request->attributes->set('user_id', (int) $header);

        return $next($request);
    }
}
