from flask import Flask, jsonify, request
from flask_cors import CORS

import os
import signal
import time


app = Flask(__name__)
CORS(app)

PUBLIC_DEPLOYMENT = os.environ.get(
    "PUBLIC_DEPLOYMENT", "false"
).lower() == "true"

app = Flask(__name__)
CORS(app)


# ============================================================
# GLOBAL CPU HISTORY
# ============================================================

previous_process_cpu = {}
previous_system_cpu = None


# ============================================================
# PROCESS DESCRIPTIONS
# ============================================================

PROCESS_DESCRIPTIONS = {
    "systemd": "System Manager",
    "kthreadd": "Kernel Thread Manager",
    "kworker": "Kernel Worker",
    "ksoftirqd": "Kernel Software Interrupt",
    "migration": "CPU Migration Manager",
    "rcu_sched": "RCU Scheduler",
    "rcu_preempt": "RCU Scheduler",
    "init": "System Initialization",

    "bash": "Linux Shell",
    "sh": "Shell Process",
    "zsh": "Z Shell",

    "cron": "Scheduled Task Manager",
    "crond": "Scheduled Task Manager",

    "sshd": "SSH Server",
    "ssh": "SSH Client",

    "python": "Python Application",
    "python3": "Python Application",

    "node": "Node.js Application",
    "npm": "Node Package Manager",

    "flask": "Flask Web Server",

    "nginx": "Web Server",
    "apache2": "Apache Web Server",

    "postgres": "PostgreSQL Database",
    "postgresql": "PostgreSQL Database",

    "mysqld": "MySQL Database Server",

    "dockerd": "Docker Engine",
    "containerd": "Container Runtime",

    "vim": "Vim Text Editor",
    "nano": "Nano Text Editor",

    "code": "Visual Studio Code",

    "dbus-daemon": "D-Bus System Service",
    "NetworkManager": "Network Manager",

    "login": "Login Process",
    "getty": "Terminal Login Service",

    "sleep": "Sleep Command",
    "top": "System Monitor",
    "htop": "Interactive Process Monitor",

    "grep": "Text Search Utility",
    "cat": "File Display Utility",
    "ls": "Directory Listing Utility",
}


# ============================================================
# HELPER: PROCESS DESCRIPTION
# ============================================================

def get_description(process_name):
    if process_name in PROCESS_DESCRIPTIONS:
        return PROCESS_DESCRIPTIONS[process_name]

    if process_name.startswith("kworker"):
        return "Kernel Worker"

    if process_name.startswith("python"):
        return "Python Application"

    if process_name.startswith("node"):
        return "Node.js Application"

    if "code" in process_name.lower():
        return "Visual Studio Code Process"

    return "User Process"


# ============================================================
# HELPER: PROCESS STATE
# ============================================================

STATE_NAMES = {
    "R": "Running",
    "S": "Sleeping",
    "D": "Waiting",
    "T": "Stopped",
    "Z": "Zombie",
    "I": "Idle",
    "X": "Dead"
}


# ============================================================
# SYSTEM CPU
# ============================================================

def get_system_cpu_time():
    try:
        with open("/proc/stat", "r") as file:
            for line in file:
                if line.startswith("cpu "):
                    values = line.split()[1:]

                    return sum(
                        int(value)
                        for value in values
                    )

    except (
        FileNotFoundError,
        PermissionError,
        ValueError
    ):
        return 0

    return 0


# ============================================================
# SYSTEM MEMORY
# ============================================================

def get_system_memory():
    memory = {
        "total_kb": 0,
        "available_kb": 0
    }

    try:
        with open("/proc/meminfo", "r") as file:

            for line in file:

                parts = line.split()

                if len(parts) < 2:
                    continue

                if parts[0] == "MemTotal:":
                    memory["total_kb"] = int(parts[1])

                elif parts[0] == "MemAvailable:":
                    memory["available_kb"] = int(parts[1])

    except (
        FileNotFoundError,
        PermissionError,
        ValueError
    ):
        pass

    return memory


# ============================================================
# PROCESS CPU TIME
# ============================================================

def get_process_cpu_time(pid):

    try:

        path = f"/proc/{pid}/stat"

        with open(path, "r") as file:
            data = file.read()

        closing_parenthesis = data.rfind(")")

        if closing_parenthesis == -1:
            return 0

        remaining = data[
            closing_parenthesis + 2:
        ].split()

        if len(remaining) < 13:
            return 0

        # After removing PID and process name:
        #
        # remaining[11] = utime
        # remaining[12] = stime

        utime = int(remaining[11])
        stime = int(remaining[12])

        return utime + stime

    except (
        FileNotFoundError,
        PermissionError,
        ValueError
    ):
        return 0


# ============================================================
# PROCESS START TIME
# ============================================================

def get_process_start_time(pid):

    try:

        path = f"/proc/{pid}/stat"

        with open(path, "r") as file:
            data = file.read()

        closing_parenthesis = data.rfind(")")

        if closing_parenthesis == -1:
            return 0

        remaining = data[
            closing_parenthesis + 2:
        ].split()

        if len(remaining) < 20:
            return 0

        # starttime is field 22
        # After PID + comm, remaining[19] = field 22

        start_ticks = int(remaining[19])

        clock_ticks = os.sysconf(
            os.sysconf_names["SC_CLK_TCK"]
        )

        return start_ticks / clock_ticks

    except (
        FileNotFoundError,
        PermissionError,
        ValueError,
        KeyError
    ):
        return 0


# ============================================================
# PROCESS UPTIME
# ============================================================

def get_process_uptime(pid):

    start_time = get_process_start_time(pid)

    if start_time <= 0:
        return 0

    try:

        with open("/proc/uptime", "r") as file:
            system_uptime = float(
                file.read().split()[0]
            )

        uptime = system_uptime - start_time

        return max(0, uptime)

    except (
        FileNotFoundError,
        PermissionError,
        ValueError
    ):
        return 0


# ============================================================
# FORMAT UPTIME
# ============================================================

def format_uptime(seconds):

    seconds = int(seconds)

    days = seconds // 86400

    seconds %= 86400

    hours = seconds // 3600

    seconds %= 3600

    minutes = seconds // 60

    seconds %= 60

    if days > 0:
        return (
            f"{days}d "
            f"{hours}h "
            f"{minutes}m"
        )

    if hours > 0:
        return (
            f"{hours}h "
            f"{minutes}m "
            f"{seconds}s"
        )

    if minutes > 0:
        return (
            f"{minutes}m "
            f"{seconds}s"
        )

    return f"{seconds}s"


# ============================================================
# PROCESS CPU PERCENTAGE
# ============================================================

def calculate_cpu_percent(
    pid,
    current_system_cpu
):

    global previous_process_cpu
    global previous_system_cpu

    current_process_cpu = (
        get_process_cpu_time(pid)
    )

    if (
        previous_system_cpu is None
        or pid not in previous_process_cpu
    ):

        previous_process_cpu[pid] = (
            current_process_cpu
        )

        return 0.0

    process_delta = (
        current_process_cpu
        - previous_process_cpu[pid]
    )

    system_delta = (
        current_system_cpu
        - previous_system_cpu
    )

    previous_process_cpu[pid] = (
        current_process_cpu
    )

    if system_delta <= 0:
        return 0.0

    cpu_count = os.cpu_count() or 1

    cpu_percent = (
        process_delta
        / system_delta
        * cpu_count
        * 100
    )

    cpu_percent = max(
        0.0,
        cpu_percent
    )

    return round(
        cpu_percent,
        2
    )


# ============================================================
# READ ONE PROCESS
# ============================================================

def read_process(pid):

    status_path = (
        f"/proc/{pid}/status"
    )

    process_pid = int(pid)
    process_ppid = 0
    process_name = "Unknown"
    process_state = "Unknown"
    memory_rss_kb = 0

    try:

        with open(
            status_path,
            "r"
        ) as file:

            for line in file:

                if line.startswith("Name:"):

                    process_name = (
                        line.split(
                            ":",
                            1
                        )[1]
                        .strip()
                    )

                elif line.startswith("Pid:"):

                    process_pid = int(
                        line.split()[1]
                    )

                elif line.startswith("PPid:"):

                    process_ppid = int(
                        line.split()[1]
                    )

                elif line.startswith("State:"):

                    state_code = (
                        line.split()[1]
                    )

                    process_state = (
                        STATE_NAMES.get(
                            state_code,
                            state_code
                        )
                    )

                elif line.startswith("VmRSS:"):

                    memory_rss_kb = int(
                        line.split()[1]
                    )

        return {
            "pid": process_pid,
            "ppid": process_ppid,
            "name": process_name,
            "state": process_state,
            "memory_rss_kb": memory_rss_kb
        }

    except (
        FileNotFoundError,
        PermissionError,
        ValueError
    ):

        return None


# ============================================================
# GET ALL PROCESSES
# ============================================================

def collect_processes():

    global previous_process_cpu
    global previous_system_cpu

    processes = []

    current_system_cpu = (
        get_system_cpu_time()
    )

    memory = get_system_memory()

    total_memory_kb = (
        memory["total_kb"]
    )

    available_memory_kb = (
        memory["available_kb"]
    )

    used_memory_kb = (
        total_memory_kb
        - available_memory_kb
    )

    if total_memory_kb > 0:

        system_memory_percent = (
            used_memory_kb
            / total_memory_kb
            * 100
        )

    else:

        system_memory_percent = 0.0

    if previous_system_cpu is None:

        previous_system_cpu = (
            current_system_cpu
        )

    try:

        proc_entries = os.listdir(
            "/proc"
        )

    except OSError:

        proc_entries = []

    for pid in proc_entries:

        if not pid.isdigit():
            continue

        process = read_process(pid)

        if process is None:
            continue

        process_pid = process["pid"]

        process_ppid = process["ppid"]

        process_name = process["name"]

        process_state = process["state"]

        memory_rss_kb = (
            process["memory_rss_kb"]
        )

        cpu_percent = (
            calculate_cpu_percent(
                process_pid,
                current_system_cpu
            )
        )

        memory_mb = (
            memory_rss_kb / 1024
        )

        if total_memory_kb > 0:

            memory_percent = (
                memory_rss_kb
                / total_memory_kb
                * 100
            )

        else:

            memory_percent = 0.0

        uptime_seconds = (
            get_process_uptime(
                process_pid
            )
        )

        processes.append({

            "pid": process_pid,

            "ppid": process_ppid,

            "name": process_name,

            "description":
                get_description(
                    process_name
                ),

            "state": process_state,

            "cpu_percent":
                round(
                    cpu_percent,
                    2
                ),

            "memory_mb":
                round(
                    memory_mb,
                    2
                ),

            "memory_percent":
                round(
                    memory_percent,
                    2
                ),

            "uptime_seconds":
                round(
                    uptime_seconds,
                    0
                ),

            "uptime":
                format_uptime(
                    uptime_seconds
                )
        })

    # Remove processes that no longer exist
    active_pids = {
        process["pid"]
        for process in processes
    }

    previous_process_cpu = {
        pid: value
        for pid, value
        in previous_process_cpu.items()
        if pid in active_pids
    }

    processes.sort(
        key=lambda process:
            process["pid"]
    )

    previous_system_cpu = (
        current_system_cpu
    )

    return {
        "system": {

            "memory_total_mb":
                round(
                    total_memory_kb / 1024,
                    2
                ),

            "memory_used_mb":
                round(
                    used_memory_kb / 1024,
                    2
                ),

            "memory_available_mb":
                round(
                    available_memory_kb / 1024,
                    2
                ),

            "memory_percent":
                round(
                    system_memory_percent,
                    2
                ),

            "cpu_count":
                os.cpu_count() or 1
        },

        "processes": processes,

        "timestamp":
            time.time()
    }


# ============================================================
# HOME
# ============================================================

@app.route("/")
def home():

    return jsonify({
        "application":
            "Linux Process Explorer",

        "status":
            "Backend is Running",

        "version":
            "1.0"
    })


# ============================================================
# GET ALL PROCESSES
# ============================================================

@app.route(
    "/api/processes",
    methods=["GET"]
)
def get_processes():

    return jsonify(
        collect_processes()
    )


# ============================================================
# GET SINGLE PROCESS
# ============================================================

@app.route(
    "/api/processes/<int:pid>",
    methods=["GET"]
)
def get_single_process(pid):

    process = read_process(
        str(pid)
    )

    if process is None:

        return jsonify({
            "success": False,
            "message":
                "Process not found"
        }), 404

    processes_data = (
        collect_processes()
    )

    matching_process = next(
        (
            process_item
            for process_item
            in processes_data["processes"]
            if process_item["pid"] == pid
        ),
        None
    )

    if matching_process is None:

        return jsonify({
            "success": False,
            "message":
                "Process no longer exists"
        }), 404

    return jsonify({
        "success": True,
        "process":
            matching_process
    })


# ============================================================
# STOP PROCESS
# ============================================================

@app.route(
    "/api/processes/<int:pid>/stop",
    methods=["POST"]
)
def stop_process(pid):

    if PUBLIC_DEPLOYMENT:
        return jsonify({
            "success": False,
            "message": "Process control is disabled on the public deployment"
        }), 403

    try:

        os.kill(
            pid,
            signal.SIGSTOP
        )

        return jsonify({
            "success": True,
            "message":
                f"Process {pid} stopped"
        })

    except ProcessLookupError:

        return jsonify({
            "success": False,
            "message":
                "Process does not exist"
        }), 404

    except PermissionError:

        return jsonify({
            "success": False,
            "message":
                "Permission denied"
        }), 403

    except OSError as error:

        return jsonify({
            "success": False,
            "message":
                str(error)
        }), 500


# ============================================================
# RESUME PROCESS
# ============================================================

@app.route(
    "/api/processes/<int:pid>/resume",
    methods=["POST"]
)
def resume_process(pid):

    if PUBLIC_DEPLOYMENT:
        return jsonify({
            "success": False,
            "message": "Process control is disabled on the public deployment"
        }), 403

    try:

        os.kill(
            pid,
            signal.SIGCONT
        )

        return jsonify({
            "success": True,
            "message":
                f"Process {pid} resumed"
        })

    except ProcessLookupError:

        return jsonify({
            "success": False,
            "message":
                "Process does not exist"
        }), 404

    except PermissionError:

        return jsonify({
            "success": False,
            "message":
                "Permission denied"
        }), 403

    except OSError as error:

        return jsonify({
            "success": False,
            "message":
                str(error)
        }), 500


# ============================================================
# TERMINATE PROCESS
# ============================================================

@app.route(
    "/api/processes/<int:pid>/terminate",
    methods=["POST"]
)
def terminate_process(pid):

    if PUBLIC_DEPLOYMENT:
        return jsonify({
            "success": False,
            "message": "Process control is disabled on the public deployment"
        }), 403

    try:

        os.kill(
            pid,
            signal.SIGTERM
        )

        return jsonify({
            "success": True,
            "message":
                f"Termination signal sent to process {pid}"
        })

    except ProcessLookupError:

        return jsonify({
            "success": False,
            "message":
                "Process does not exist"
        }), 404

    except PermissionError:

        return jsonify({
            "success": False,
            "message":
                "Permission denied"
        }), 403

    except OSError as error:

        return jsonify({
            "success": False,
            "message":
                str(error)
        }), 500


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )
