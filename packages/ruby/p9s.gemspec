# frozen_string_literal: true

require_relative "lib/p9s/version"

Gem::Specification.new do |spec|
  spec.name = "p9s"
  spec.version = P9s::VERSION
  spec.authors = ["Vincent Lecrubier"]
  spec.summary = "Act as a user of p9s, permissions of trees in Postgres, from Active Record and Rails"
  spec.description = "Runs Active Record transactions as a user of p9s, so that the row level security policies of p9s " \
                     "decide what each query reads and writes, and tells the writes they refuse."
  spec.homepage = "https://github.com/crubier/p9s/tree/main/packages/ruby"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"
  spec.metadata = {
    "source_code_uri" => "https://github.com/crubier/p9s",
    "documentation_uri" => "https://github.com/crubier/p9s/tree/main/packages/ruby",
    "rubygems_mfa_required" => "true"
  }
  spec.files = Dir["lib/**/*.rb", "README.md", "LICENSE"]
  spec.require_paths = ["lib"]
  spec.add_dependency "activerecord", ">= 7.0"
end
