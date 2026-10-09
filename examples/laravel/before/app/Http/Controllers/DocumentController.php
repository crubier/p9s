<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Permissions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DocumentController extends Controller
{
    public function index(Request $request)
    {
        return Permissions::readableDocuments($this->userId($request))->get(['id', 'project_id', 'title']);
    }

    public function store(Request $request)
    {
        $data = $request->validate(['project_id' => 'required|integer', 'title' => 'required|string', 'body' => 'string']);
        if (! in_array('write', Permissions::projectBits($this->userId($request), $data['project_id']), true)) {
            return $this->forbidden();
        }

        $document = Document::create(['body' => '', ...$data]);

        return response()->json($document, 201);
    }

    public function show(Request $request, int $id)
    {
        $bits = Permissions::documentBits($this->userId($request), $id);
        if (! in_array('read', $bits ?? [], true)) {
            return $this->notFound();
        }

        return Document::find($id);
    }

    public function update(Request $request, int $id)
    {
        $bits = Permissions::documentBits($this->userId($request), $id);
        if (! in_array('read', $bits ?? [], true)) {
            return $this->notFound();
        }
        if (! in_array('write', $bits, true)) {
            return $this->forbidden();
        }

        Document::whereKey($id)->update($request->only(['title', 'body']));

        return Document::find($id);
    }

    public function destroy(Request $request, int $id)
    {
        $bits = Permissions::documentBits($this->userId($request), $id);
        if (! in_array('read', $bits ?? [], true)) {
            return $this->notFound();
        }
        if (! in_array('delete', $bits, true)) {
            return $this->forbidden();
        }

        Document::whereKey($id)->delete();

        return response()->noContent();
    }

    public function share(Request $request, int $id, int $userId)
    {
        $access = $request->validate(['access' => 'required|in:viewer,editor'])['access'];
        $bits = Permissions::documentBits($this->userId($request), $id);
        if (! in_array('read', $bits ?? [], true)) {
            return $this->notFound();
        }

        $previous = DB::table('document_shares')->where(['document_id' => $id, 'user_id' => $userId])->value('access');
        if (array_diff([...Permissions::bitsOf($access), ...Permissions::bitsOf($previous)], $bits) !== []) {
            return $this->forbidden();
        }

        DB::table('document_shares')->upsert(
            ['document_id' => $id, 'user_id' => $userId, 'access' => $access],
            ['document_id', 'user_id'],
            ['access'],
        );

        return response()->noContent();
    }
}
