<?php

use App\Http\Controllers\DocumentController;
use App\Http\Controllers\ProjectController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response('ok'));

Route::middleware('authenticate')->group(function () {
    Route::get('/projects', [ProjectController::class, 'index']);
    Route::get('/documents', [DocumentController::class, 'index']);
    Route::post('/documents', [DocumentController::class, 'store']);
    Route::get('/documents/{id}', [DocumentController::class, 'show'])->whereNumber('id');
    Route::patch('/documents/{id}', [DocumentController::class, 'update'])->whereNumber('id');
    Route::delete('/documents/{id}', [DocumentController::class, 'destroy'])->whereNumber('id');
    Route::put('/documents/{id}/shares/{userId}', [DocumentController::class, 'share'])->whereNumber(['id', 'userId']);
});
