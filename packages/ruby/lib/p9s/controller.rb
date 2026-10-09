# frozen_string_literal: true

require "active_support/concern"

module P9s
  # Runs every action of a controller in a transaction as the user of its request, current_user.id by default:
  #
  #   class ApplicationController < ActionController::API
  #     include P9s::Controller
  #   end
  #
  # Override p9s_user_id for another user, and p9s_read_only? for read only transactions.
  module Controller
    extend ActiveSupport::Concern

    included do
      around_action :p9s_as_user
    end

    private

    def p9s_as_user(&action)
      P9s.as_user(p9s_user_id, read_only: p9s_read_only?, &action)
    end

    def p9s_user_id
      respond_to?(:current_user, true) ? current_user&.id : nil
    end

    def p9s_read_only?
      false
    end
  end
end
