-- Invite codes are matched case-insensitively, so they must be unique that way too.
create unique index societies_invite_code_lower_idx on societies (lower(trim(invite_code)));
