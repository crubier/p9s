<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Deleting a document deletes its shares in the database, with cascadeOnDelete */
class Document extends Model
{
    public $timestamps = false;

    protected $fillable = ['project_id', 'title', 'body'];
}
