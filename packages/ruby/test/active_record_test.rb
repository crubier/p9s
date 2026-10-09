# frozen_string_literal: true

require "test_helper"
require "action_controller"

class ActiveRecordTest < Minitest::Test
  include DatabaseTest

  def test_as_user
    assert_equal %w[p9s_ruby_user 7], P9s.as_user(7) { who }
    refute_equal "p9s_ruby_user", who.first
  end

  def test_read_only
    error = assert_raises(ActiveRecord::StatementInvalid) do
      P9s.as_user(7, role: "p9s_ruby_writer", read_only: true) do
        ActiveRecord::Base.connection.execute("insert into p9s_ruby_note (body) values ('read only')")
      end
    end
    assert_match(/read-only transaction/, error.message)
  end

  def test_a_refused_write_is_refused
    error = assert_raises(ActiveRecord::StatementInvalid) do
      P9s.as_user(7) { ActiveRecord::Base.connection.execute("insert into p9s_ruby_note (body) values ('refused')") }
    end
    assert P9s.refused?(error)
  end

  def test_a_rolled_back_transaction_leaves_nothing_on_the_connection
    assert_raises(RuntimeError) { P9s.as_user(7) { raise "rolled back" } }
    refute_equal "p9s_ruby_user", who.first
    assert_includes [nil, ""], who.last
  end

  class NotesController < ActionController::API
    include P9s::Controller

    def index
      render json: ActiveRecord::Base.connection.select_rows("select current_user, current_setting('app.user_id', true)").first
    end

    private

    def p9s_user_id
      request.headers["x-user-id"]
    end
  end

  def test_the_controller_acts_as_the_user_of_the_request
    request = ActionDispatch::TestRequest.create("HTTP_X_USER_ID" => "42")
    _, _, body = NotesController.action(:index).call(request.env)
    assert_equal %w[p9s_ruby_user 42], JSON.parse(body.body)
    refute_equal "p9s_ruby_user", who.first
  end
end
