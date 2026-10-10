<?php

namespace App\Http\Controllers;

use App\Permissions;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(Request $request)
    {
        return Permissions::readableProjects($this->userId($request))->get(['id', 'name']);
    }
}
