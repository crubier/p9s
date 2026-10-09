<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

abstract class Controller
{
    protected function userId(Request $request): int
    {
        return $request->attributes->get('user_id');
    }

    protected function notFound(): JsonResponse
    {
        return response()->json(['error' => 'not found'], 404);
    }

    protected function forbidden(): JsonResponse
    {
        return response()->json(['error' => 'forbidden'], 403);
    }
}
