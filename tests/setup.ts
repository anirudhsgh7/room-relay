process.env.ROOMRELAY_SESSION_SECRET =
  "roomrelay-test-session-secret-do-not-use-outside-tests-0001";
process.env.ROOMRELAY_CAMPUS_TIMEZONE = "Europe/London";
process.env.TEST_DATABASE_URL ??=
  "postgresql://roomrelay:roomrelay_test@127.0.0.1:55432/roomrelay_test";
