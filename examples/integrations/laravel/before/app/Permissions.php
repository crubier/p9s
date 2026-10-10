<?php

namespace App;

use App\Models\Document;
use App\Models\Project;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * Who may do what, as the app decides it before p9s: from the shares of projects with the teams of the user, and the
 * shares of documents with the user
 */
class Permissions
{
    public const BITS = ['viewer' => ['read'], 'editor' => ['read', 'write'], 'owner' => ['read', 'write', 'delete']];

    /** @return list<string> */
    public static function bitsOf(?string $access): array
    {
        return $access === null ? [] : self::BITS[$access];
    }

    /** @return list<string> */
    public static function projectBits(int $userId, mixed $projectId): array
    {
        $accesses = DB::table('project_shares')
            ->where('project_id', $projectId)
            ->whereIn('team_id', self::teamsOf($userId))
            ->pluck('access');

        return array_values(array_unique($accesses->flatMap(self::bitsOf(...))->all()));
    }

    /**
     * The bits of the user on the document, or null when there is no such document
     *
     * @return list<string>|null
     */
    public static function documentBits(int $userId, int $documentId): ?array
    {
        $projectId = Document::whereKey($documentId)->value('project_id');
        if ($projectId === null) {
            return null;
        }
        $share = DB::table('document_shares')->where(['document_id' => $documentId, 'user_id' => $userId])->value('access');

        return array_values(array_unique([...self::projectBits($userId, $projectId), ...self::bitsOf($share)]));
    }

    /**
     * Every share gives read, so a user reads the projects shared with their teams, and the documents of those
     * projects or shared with them
     */
    public static function readableProjects(int $userId): Builder
    {
        return Project::whereIn('id', self::readableProjectIds($userId))->orderBy('id');
    }

    public static function readableDocuments(int $userId): Builder
    {
        $shared = DB::table('document_shares')->where('user_id', $userId)->select('document_id');

        return Document::where(fn (Builder $documents) => $documents
            ->whereIn('project_id', self::readableProjectIds($userId))
            ->orWhereIn('id', $shared))
            ->orderBy('id');
    }

    private static function teamsOf(int $userId): QueryBuilder
    {
        return DB::table('team_members')->where('user_id', $userId)->select('team_id');
    }

    private static function readableProjectIds(int $userId): QueryBuilder
    {
        return DB::table('project_shares')->whereIn('team_id', self::teamsOf($userId))->select('project_id');
    }
}
