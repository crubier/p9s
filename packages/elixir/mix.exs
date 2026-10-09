defmodule P9s.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source "https://github.com/crubier/p9s"

  def project do
    [
      app: :p9s,
      version: @version,
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: "Act as a user of p9s, permissions of trees in Postgres, from Ecto and Phoenix",
      package: [
        licenses: ["MIT"],
        links: %{"GitHub" => @source},
        files: ~w(lib mix.exs README.md LICENSE)
      ],
      docs: [main: "readme", extras: ["README.md"], source_url: @source]
    ]
  end

  def application, do: [extra_applications: [:logger]]

  defp deps do
    [
      {:ecto_sql, "~> 3.12"},
      {:postgrex, ">= 0.19.0"},
      {:phoenix, "~> 1.7", optional: true},
      {:plug, "~> 1.15", optional: true},
      {:ex_doc, "~> 0.34", only: :dev, runtime: false}
    ]
  end
end
