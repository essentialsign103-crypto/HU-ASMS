-- HU-ASMS: Haramaya University Academic Submission Management System
-- Migration 03: Private Storage Bucket Setup & Security Policies

-- 1. Create Private Storage Bucket for Submissions
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'submission-files-vault',
    'submission-files-vault',
    false,
    52428800, -- 50 MB in bytes
    ARRAY[
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
        'application/pdf',
        'application/zip',
        'application/x-zip-compressed',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword'
    ];

-- 2. Storage Objects Row Level Security Policies

-- Policy: System Owner has full access to all stored submission files
CREATE POLICY "owner_full_storage_access"
ON storage.objects
FOR ALL
TO authenticated
USING (
    bucket_id = 'submission-files-vault' AND
    auth_is_system_owner()
)
WITH CHECK (
    bucket_id = 'submission-files-vault' AND
    auth_is_system_owner()
);

-- Policy: Section Representatives can download files for submissions within their assigned sections
CREATE POLICY "representative_read_storage_objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'submission-files-vault' AND
    EXISTS (
        SELECT 1
        FROM submission_files sf
        JOIN submissions s ON s.id = sf.submission_id
        WHERE sf.storage_path = storage.objects.name
          AND auth_is_rep_for_section(s.section_id)
    )
);
