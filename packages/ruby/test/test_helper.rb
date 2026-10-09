# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "active_record"
require "p9s"

DATABASE_URL = ENV.fetch("P9S_TEST_DATABASE_URL", nil)

CONFIG = {
  "engine" => {
    "users" => ["p9s_ruby_user"],
    "graphWriters" => ["p9s_ruby_writer"],
    "authentication" => { "getCurrentUserId" => "current_role_id", "setting" => "app.user_id" }
  },
  "tables" => []
}.freeze

module DatabaseTest
  def self.included(base)
    base.class_eval do
      def setup
        skip "P9S_TEST_DATABASE_URL is not set" unless DATABASE_URL
        DatabaseTest.prepare
        P9s.identity = P9s::Identity.new(CONFIG)
      end
    end
  end

  # A table the user role reads but cannot write, and the roles of the config
  def self.prepare
    return if @prepared

    ActiveRecord::Base.establish_connection(DATABASE_URL)
    ActiveRecord::Base.connection.execute(<<~SQL)
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'p9s_ruby_user') then create role p9s_ruby_user nologin; end if;
        if not exists (select from pg_roles where rolname = 'p9s_ruby_writer') then create role p9s_ruby_writer nologin; end if;
      end
      $$;
      grant p9s_ruby_user, p9s_ruby_writer to current_user;
      drop table if exists p9s_ruby_note;
      create table p9s_ruby_note (id serial primary key, body text not null);
      grant select on p9s_ruby_note to p9s_ruby_user;
      grant select, insert on p9s_ruby_note to p9s_ruby_writer;
      grant usage on sequence p9s_ruby_note_id_seq to p9s_ruby_writer;
    SQL
    @prepared = true
  end

  def who
    ActiveRecord::Base.connection.select_rows("select current_user, current_setting('app.user_id', true)").first
  end
end
