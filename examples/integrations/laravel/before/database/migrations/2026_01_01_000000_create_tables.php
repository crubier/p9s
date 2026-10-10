<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
            $table->text('name')->unique();
        });

        Schema::create('teams', function (Blueprint $table) {
            $table->increments('id');
            $table->text('name')->unique();
        });

        Schema::create('team_members', function (Blueprint $table) {
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->primary(['team_id', 'user_id']);
        });

        Schema::create('projects', function (Blueprint $table) {
            $table->increments('id');
            $table->text('name');
        });

        Schema::create('project_shares', function (Blueprint $table) {
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('team_id')->index()->constrained()->cascadeOnDelete();
            $table->text('access');
            $table->primary(['project_id', 'team_id']);
        });

        Schema::create('documents', function (Blueprint $table) {
            $table->increments('id');
            $table->foreignId('project_id')->index()->constrained()->cascadeOnDelete();
            $table->text('title');
            $table->text('body')->default('');
        });

        Schema::create('document_shares', function (Blueprint $table) {
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->text('access');
            $table->primary(['document_id', 'user_id']);
        });

        DB::statement("alter table project_shares add constraint project_shares_access_check check (access in ('viewer', 'editor', 'owner'))");
        DB::statement("alter table document_shares add constraint document_shares_access_check check (access in ('viewer', 'editor'))");
    }

    public function down(): void
    {
        foreach (['document_shares', 'documents', 'project_shares', 'projects', 'team_members', 'teams', 'users'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
