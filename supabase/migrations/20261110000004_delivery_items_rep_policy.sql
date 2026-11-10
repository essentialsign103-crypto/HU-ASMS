-- HU-ASMS: Migration 04 - Delivery Items Representative RLS Policies
-- Grants section representatives authorization to insert and manage delivery items for their assigned sections

CREATE POLICY "rep_manage_section_delivery_items" ON delivery_items
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            WHERE d.id = delivery_items.delivery_id
              AND auth_is_rep_for_section(d.section_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM deliveries d
            WHERE d.id = delivery_items.delivery_id
              AND auth_is_rep_for_section(d.section_id)
        )
    );
