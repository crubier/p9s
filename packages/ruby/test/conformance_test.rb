# frozen_string_literal: true

require "test_helper"

# The conformance suite of p9s, see packages/conformance
class ConformanceTest < Minitest::Test
  URL = ENV.fetch("P9S_CONFORMANCE_DATABASE_URL", nil)
  SUITE = File.expand_path("../../conformance", __dir__)
  CASES = JSON.parse(File.read(File.join(SUITE, "cases.json")))

  class Record < ActiveRecord::Base
    self.abstract_class = true
  end

  class RolledBack < StandardError; end

  def setup
    skip "P9S_CONFORMANCE_DATABASE_URL is not set" unless URL
    Record.establish_connection("#{URL}#{URL.include?('?') ? '&' : '?'}pool=1") unless Record.connected?
    @users = P9s::Identity.from_file(File.join(SUITE, CASES["config"]))
  end

  def as_user(user_id, **options, &block)
    P9s.as_user(user_id, identity: @users, model: Record, **options, &block)
  end

  def query(sql)
    Record.connection.select_all(sql).rows
  end

  def test_the_role_and_the_setting_come_from_the_config
    assert_equal [CASES["role"], CASES["setting"]], [@users.role, @users.setting]
  end

  def test_each_user_reads_their_rows_on_one_connection_in_turns
    2.times do
      CASES["reads"].each do |read|
        assert_equal read["ids"], as_user(read["user"], read_only: true) { query(CASES["read"]).map(&:first) }
      end
    end
  end

  def test_insert_returning_works
    insert = CASES["insert"]
    id, folder_id = as_user(insert["user"]) { query(insert["sql"]).first }
    assert_equal insert["folderId"], folder_id
    assert_operator id, :>, 3
  end

  def test_a_refused_write_is_an_error
    error = assert_raises(ActiveRecord::StatementInvalid) do
      as_user(CASES["refused"]["user"]) { query(CASES["refused"]["sql"]) }
    end
    assert P9s.refused?(error)
  end

  def test_a_rolled_back_transaction_leaves_nothing_on_the_connection
    inside = nil
    assert_raises(RolledBack) do
      as_user(CASES["whoUser"]) do
        inside = query(CASES["who"]).first
        raise RolledBack
      end
    end
    assert_equal [CASES["role"], CASES["whoUser"].to_s], inside
    role, user_id = query(CASES["who"]).first
    refute_equal CASES["role"], role
    assert_equal "", user_id
  end
end
