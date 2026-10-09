require_relative "boot"

require "rails"
require "active_record/railtie"
require "action_controller/railtie"

Bundler.require(*Rails.groups)

module Documents
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true
    config.eager_load = Rails.env.production?
    config.secret_key_base = ENV.fetch("SECRET_KEY_BASE", "an example, not a secret")
    config.hosts.clear
    config.logger = ActiveSupport::Logger.new($stdout)
    config.active_record.dump_schema_after_migration = false
  end
end
