#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 -m pip install -r requirements.txt
echo "Starting PulseWatch at http://localhost:5000"
python3 app.py
