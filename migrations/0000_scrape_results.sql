-- Migration number: 0000 	 2023-08-02T19:38:39.636Z
CREATE TABLE scrape_results
    ( created_at TEXT NOT NULL PRIMARY KEY
    , scrape_results_json TEXT NOT NULL
    );
