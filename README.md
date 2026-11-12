# Jobs Near Me (Flask)

    pip install -r requirements.txt
    python app.py          # http://127.0.0.1:5000

- Users:  `/`  – map + nearby employers, click one to see all its jobs
- Admin:  `/admin/login` – default `admin` / `admin123`

Set real credentials before deploying:

    export SECRET_KEY="long-random-string" ADMIN_USER="you" ADMIN_PASS="strong-password"
