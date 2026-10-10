# frozen_string_literal: true

require "json"
require "set"

module P9s
  # What a transaction needs to act as an application user: the database role the policies are for, and the setting the
  # current user function of the migration reads, from engine.authentication of the config of p9s. Both are set with
  # set_config(..., true), so that they end with the transaction, and a pooled connection never keeps the identity of a
  # previous request.
  class Identity
    attr_reader :role, :setting, :claim, :roles

    def self.from_file(path, **options)
      new(JSON.parse(File.read(path)), **options)
    end

    def initialize(config, setting: nil, claim: nil)
      engine = config.fetch("engine", nil) || {}
      authentication = engine.fetch("authentication", nil) || {}
      users = Array(engine["users"])
      raise ArgumentError, "p9s: engine.users is empty" if users.empty?

      @setting = setting || authentication["setting"].to_s
      if @setting.empty?
        raise ArgumentError, 'p9s: set engine.authentication.setting, like "app.user_id", for the migration to read the ' \
                             "current user from it, or pass the setting the current user function reads"
      end
      # The claim of the setting, when it holds JSON claims, like request.jwt.claims of PostgREST
      @claim = claim.nil? && setting.nil? ? authentication["claim"] : claim
      @role = users.first
      @roles = Set.new(users + Array(engine["graphWriters"])).freeze
    end

    def value(user_id)
      return "" if user_id.nil?

      claim ? JSON.generate(claim => user_id.to_s) : user_id.to_s
    end

    # The settings of a transaction of the user, as [name, value] pairs, the role first, with transaction_read_only for a
    # read only transaction, which Postgres takes even after the transaction has run a statement. No user reads as no one.
    def settings(user_id, role: nil, settings: {}, read_only: false)
      chosen = role || self.role
      raise ArgumentError, "p9s: #{chosen} is not a role of engine.users or engine.graphWriters" unless roles.include?(chosen)

      [["role", chosen], [setting, value(user_id)], *settings.map { |name, value| [name.to_s, text(value)] },
       *(read_only ? [%w[transaction_read_only on]] : [])]
    end

    # The statement to run first in a transaction, with positional parameters:
    # ["select set_config($1, $2, true), ...", [values]]
    def statement(user_id, **options)
      pairs = settings(user_id, **options)
      calls = pairs.each_index.map { |index| "set_config($#{(2 * index) + 1}, $#{(2 * index) + 2}, true)" }
      ["select #{calls.join(', ')}", pairs.flatten]
    end

    private

    def text(value)
      case value
      when nil then ""
      when true then "on"
      when false then "off"
      else value.to_s
      end
    end
  end
end
