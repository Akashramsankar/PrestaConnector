module.exports = {
  test: {
    coverage: {
      all: true,
      include: ["test-coverage/coverage-target.js"],
      reporter: ["text", "json", "json-summary", "lcov"],
      reportsDirectory: "coverage/unit",
    },
  },
};
