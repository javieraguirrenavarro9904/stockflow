CREATE TABLE IF NOT EXISTS employee_movement_alerts (
  movement_id UUID PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_movement_alert_reads (
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL REFERENCES employee_movement_alerts(movement_id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, movement_id)
);

CREATE OR REPLACE FUNCTION notify_admin_of_employee_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by AND role = 'employee') THEN
    INSERT INTO employee_movement_alerts (movement_id)
    VALUES (NEW.id)
    ON CONFLICT (movement_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_movement_alert_trigger ON movements;
CREATE TRIGGER employee_movement_alert_trigger
AFTER INSERT ON movements
FOR EACH ROW
EXECUTE FUNCTION notify_admin_of_employee_movement();
