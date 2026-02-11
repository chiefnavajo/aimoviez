-- Enable AI Movie Generation feature flag
UPDATE feature_flags SET enabled = true WHERE key = 'ai_movie_generation';
