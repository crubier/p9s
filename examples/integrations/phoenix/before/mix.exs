defmodule Documents.MixProject do
  use Mix.Project

  def project do
    [app: :documents, version: "0.1.0", elixir: "~> 1.18", start_permanent: Mix.env() == :prod, deps: deps()]
  end

  def application, do: [mod: {Documents.Application, []}, extra_applications: [:logger]]

  defp deps do
    [
      {:bandit, "~> 1.5"},
      {:ecto_sql, "~> 3.12"},
      {:phoenix, "~> 1.8"},
      {:postgrex, ">= 0.19.0"}
    ]
  end
end
