# frozen_string_literal: true

require "test_helper"
require "tmpdir"

class IdentityTest < Minitest::Test
  def test_settings_take_the_first_user_role_and_the_setting
    users = P9s::Identity.new(CONFIG)
    assert_equal "p9s_ruby_user", users.role
    assert_equal [%w[role p9s_ruby_user], %w[app.user_id 7]], users.settings(7)
    assert_equal [%w[role p9s_ruby_user], ["app.user_id", ""]], users.settings(nil)
    assert_equal [%w[role p9s_ruby_writer], %w[app.user_id alice], %w[app.audit on], ["app.reason", ""]],
                 users.settings("alice", role: "p9s_ruby_writer", settings: { "app.audit" => true, "app.reason" => nil })
  end

  def test_the_statement_has_positional_parameters
    assert_equal ["select set_config($1, $2, true), set_config($3, $4, true)", %w[role p9s_ruby_user app.user_id 7]],
                 P9s::Identity.new(CONFIG).statement(7)
  end

  def test_a_claim_sets_json_claims
    config = { "engine" => { "users" => ["authenticated"], "authentication" => { "setting" => "request.jwt.claims", "claim" => "sub" } } }
    assert_equal ["request.jwt.claims", '{"sub":"7"}'], P9s::Identity.new(config).settings(7)[1]
    assert_equal %w[app.user_id 7], P9s::Identity.new(config, setting: "app.user_id").settings(7)[1]
  end

  def test_from_file
    Dir.mktmpdir do |directory|
      path = File.join(directory, "p9s.config.json")
      File.write(path, JSON.generate(CONFIG))
      assert_equal "app.user_id", P9s::Identity.from_file(path).setting
    end
  end

  def test_roles_and_settings_are_checked
    error = assert_raises(ArgumentError) { P9s::Identity.new(CONFIG).settings(7, role: "postgres") }
    assert_match(/not a role/, error.message)
    error = assert_raises(ArgumentError) { P9s::Identity.new({ "engine" => { "authentication" => { "setting" => "s" } } }) }
    assert_match(/engine.users is empty/, error.message)
    error = assert_raises(ArgumentError) { P9s::Identity.new({ "engine" => { "users" => ["app_user"] } }) }
    assert_match(/engine.authentication.setting/, error.message)
  end

  class PostgresError < StandardError
    attr_reader :sqlstate

    def initialize(sqlstate)
      super("postgres")
      @sqlstate = sqlstate
    end
  end

  def wrapped(error)
    raise error
  rescue StandardError
    begin
      raise "wrapped"
    rescue StandardError => wrapper
      wrapper
    end
  end

  def test_refused_looks_through_causes
    assert P9s.refused?(PostgresError.new("42501"))
    assert P9s.refused?(wrapped(PostgresError.new("42501")))
    refute P9s.refused?(wrapped(PostgresError.new("23505")))
    refute P9s.refused?(ArgumentError.new("nope"))
    refute P9s.refused?(nil)
  end
end
