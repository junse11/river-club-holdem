CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    nickname VARCHAR(32) NOT NULL,
    guest BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE oauth_account (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id),
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('GOOGLE', 'KAKAO')),
    provider_subject VARCHAR(255) NOT NULL,
    UNIQUE(provider, provider_subject)
);
