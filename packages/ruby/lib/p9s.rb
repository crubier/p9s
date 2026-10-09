# frozen_string_literal: true

require_relative "p9s/version"
require_relative "p9s/identity"

# Act as a user of p9s from Active Record: P9s.as_user(user_id) { ... } runs a block in a transaction as the user, and
# P9s::Controller every action of a Rails controller.
module P9s
  INSUFFICIENT_PRIVILEGE = "42501"

  autoload :Controller, "p9s/controller"

  class << self
    attr_writer :identity

    # The identity of p9s.config.json: the one P9S_CONFIG names, or the one at the root of the Rails app
    def identity
      @identity ||= Identity.from_file(ENV.fetch("P9S_CONFIG") { default_config_path })
    end

    # Runs the block in a transaction as the user: every query of the connection goes through the policies, it commits
    # when the block ends, and rolls back when it raises. Inside a transaction already, acts as the user until it ends.
    def as_user(user_id, read_only: false, role: nil, settings: {}, identity: self.identity, model: ::ActiveRecord::Base, &block)
      model.transaction do
        set_user(user_id, read_only: read_only, role: role, settings: settings, identity: identity, model: model)
        block.call
      end
    end

    # Acts as the user for the rest of the current transaction
    def set_user(user_id, read_only: false, role: nil, settings: {}, identity: self.identity, model: ::ActiveRecord::Base)
      connection = model.connection
      connection.execute("set transaction read only") if read_only
      sql, values = identity.statement(user_id, role: role, settings: settings)
      connection.select_all(model.sanitize_sql_array([sql.gsub(/\$\d+/, "?"), *values]), "p9s")
      nil
    end

    # Whether an error is Postgres refusing a statement to the user, with insufficient_privilege (42501): a row the
    # policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have.
    # Active Record wraps the error of pg in ActiveRecord::StatementInvalid, its cause.
    def refused?(error)
      current = error
      8.times do
        return false if current.nil?
        return true if sqlstate_of(current) == INSUFFICIENT_PRIVILEGE

        current = current.cause
      end
      false
    end

    private

    def default_config_path
      defined?(::Rails.root) && ::Rails.root ? ::Rails.root.join("p9s.config.json").to_s : "p9s.config.json"
    end

    def sqlstate_of(error)
      return error.sqlstate if error.respond_to?(:sqlstate)
      return unless error.respond_to?(:result) && error.result.respond_to?(:error_field)

      error.result.error_field(::PG::Result::PG_DIAG_SQLSTATE)
    end
  end
end
