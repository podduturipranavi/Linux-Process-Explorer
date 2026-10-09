import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL ||
  'http://127.0.0.1:5000'
).replace(/\/$/, '');

function App() {
  const [page, setPage] = useState("dashboard");

  const [processes, setProcesses] = useState([]);
  const [system, setSystem] = useState(null);

  // Search input and actual search are kept separate.
  // This prevents the table from changing while typing.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lastUpdated, setLastUpdated] = useState(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(3);

  const [sortField, setSortField] = useState("pid");
  const [sortDirection, setSortDirection] = useState("asc");

  const [selectedProcess, setSelectedProcess] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  // ==========================================================
  // FETCH PROCESS DATA
  // ==========================================================

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/processes`
      );

      if (!response.ok) {
        throw new Error(
          "Backend returned an error."
        );
      }

      const data = await response.json();

      setProcesses(data.processes || []);
      setSystem(data.system || null);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);

      setError(
        "Unable to connect to the Linux Process Explorer backend. Make sure Flask is running on port 5000."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  // ==========================================================
  // AUTO REFRESH
  // ==========================================================

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = setInterval(
      fetchProcesses,
      refreshInterval * 1000
    );

    return () => clearInterval(timer);
  }, [
    autoRefresh,
    refreshInterval,
    fetchProcesses,
  ]);

  // ==========================================================
  // STATISTICS
  // ==========================================================

  const stats = useMemo(() => {
    return {
      total: processes.length,

      running: processes.filter(
        (process) =>
          process.state === "Running"
      ).length,

      sleeping: processes.filter(
        (process) =>
          process.state === "Sleeping"
      ).length,

      waiting: processes.filter(
        (process) =>
          process.state === "Waiting"
      ).length,

      stopped: processes.filter(
        (process) =>
          process.state === "Stopped"
      ).length,

      zombie: processes.filter(
        (process) =>
          process.state === "Zombie"
      ).length,
    };
  }, [processes]);

  // ==========================================================
  // SEARCH + SORT
  // ==========================================================

  const filteredProcesses = useMemo(() => {
    const query = search.trim().toLowerCase();

    let result = processes;

    if (query) {
      result = processes.filter((process) => {
        return [
          process.pid,
          process.ppid,
          process.name,
          process.description,
          process.state,
          process.cpu_percent,
          process.memory_mb,
        ].some((value) =>
          String(value)
            .toLowerCase()
            .includes(query)
        );
      });
    }

    return [...result].sort((a, b) => {
      let first = a[sortField];
      let second = b[sortField];

      if (
        typeof first === "string"
      ) {
        first = first.toLowerCase();
        second = String(second).toLowerCase();
      }

      if (first < second) {
        return sortDirection === "asc"
          ? -1
          : 1;
      }

      if (first > second) {
        return sortDirection === "asc"
          ? 1
          : -1;
      }

      return 0;
    });
  }, [
    processes,
    search,
    sortField,
    sortDirection,
  ]);

  // ==========================================================
  // SEARCH
  // ==========================================================

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  // ==========================================================
  // SORT
  // ==========================================================

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(
        sortDirection === "asc"
          ? "desc"
          : "asc"
      );
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // ==========================================================
  // STATE CLASS
  // ==========================================================

  const getStateClass = (state) => {
    if (!state) {
      return "state-unknown";
    }

    return `state-${state.toLowerCase()}`;
  };

  // ==========================================================
  // PROCESS ACTIONS
  // ==========================================================

  const processAction = async (
    pid,
    action
  ) => {
    let confirmed = true;

    if (action === "terminate") {
      confirmed = window.confirm(
        `Are you sure you want to terminate process ${pid}?`
      );
    }

    if (!confirmed) {
      return;
    }

    setActionLoading(
      `${action}-${pid}`
    );

    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/processes/${pid}/${action}`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Process action failed."
        );
      }

      setMessage(data.message);

      setTimeout(
        fetchProcesses,
        500
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // ==========================================================
  // PROCESS TREE
  // ==========================================================

  const processTree = useMemo(() => {
    const map = new Map();

    processes.forEach((process) => {
      map.set(process.pid, {
        ...process,
        children: [],
      });
    });

    const roots = [];

    processes.forEach((process) => {
      const current =
        map.get(process.pid);

      const parent =
        map.get(process.ppid);

      if (
        parent &&
        process.pid !== process.ppid
      ) {
        parent.children.push(current);
      } else {
        roots.push(current);
      }
    });

    return roots;
  }, [processes]);

  // ==========================================================
  // TREE NODE
  // ==========================================================

  const TreeNode = ({
    process,
    level = 0,
  }) => {
    return (
      <div>
        <div
          className="tree-node"
          style={{
            marginLeft:
              `${level * 24}px`,
          }}
          onClick={() =>
            setSelectedProcess(process)
          }
        >
          <span className="tree-branch">
            {level > 0 ? "└─" : "●"}
          </span>

          <span className="tree-pid">
            {process.pid}
          </span>

          <span className="tree-name">
            {process.name}
          </span>

          <span
            className={
              `state-badge small-state ${
                getStateClass(
                  process.state
                )
              }`
            }
          >
            {process.state}
          </span>
        </div>

        {process.children &&
          process.children.map(
            (child) => (
              <TreeNode
                key={child.pid}
                process={child}
                level={level + 1}
              />
            )
          )}
      </div>
    );
  };

  // ==========================================================
  // NAVIGATION
  // ==========================================================

  const navigationItems = [
    {
      id: "dashboard",
      icon: "▣",
      label: "Dashboard",
    },
    {
      id: "processes",
      icon: "☷",
      label: "Processes",
    },
    {
      id: "tree",
      icon: "⌘",
      label: "Process Tree",
    },
    {
      id: "system",
      icon: "◉",
      label: "System Information",
    },
  ];

  // ==========================================================
  // RESOURCE CARD
  // ==========================================================

  const ResourceCard = ({
    title,
    value,
    subtitle,
    percent,
    icon,
  }) => {
    return (
      <div className="resource-card">
        <div className="resource-card-top">
          <div className="resource-icon">
            {icon}
          </div>

          <span className="resource-title">
            {title}
          </span>
        </div>

        <div className="resource-value">
          {value}
        </div>

        {percent !== undefined && (
          <div className="resource-progress">
            <div className="resource-progress-track">
              <div
                className="resource-progress-fill"
                style={{
                  width:
                    `${Math.min(
                      percent,
                      100
                    )}%`,
                }}
              />
            </div>

            <span>
              {percent.toFixed(1)}%
            </span>
          </div>
        )}

        <div className="resource-subtitle">
          {subtitle}
        </div>
      </div>
    );
  };

  // ==========================================================
  // STAT CARD
  // ==========================================================

  const StatCard = ({
    title,
    value,
    icon,
    className,
  }) => {
    return (
      <div
        className={
          `stat-card ${
            className || ""
          }`
        }
      >
        <div className="stat-icon">
          {icon}
        </div>

        <div>
          <p>{title}</p>

          <h2>{value}</h2>
        </div>
      </div>
    );
  };

  // ==========================================================
  // SORT ARROW
  // ==========================================================

  const SortArrow = ({
    field,
  }) => {
    if (sortField !== field) {
      return (
        <span className="sort-arrow">
          ↕
        </span>
      );
    }

    return (
      <span className="sort-arrow active">
        {sortDirection === "asc"
          ? "↑"
          : "↓"}
      </span>
    );
  };

  // ==========================================================
  // DASHBOARD
  // ==========================================================

  const DashboardPage = () => {
    return (
      <>
        <div className="page-title">
          <div>
            <h2>Dashboard</h2>

            <p>
              Overview of the Linux system
              and running processes
            </p>
          </div>

          <div className="live-status">
            <span></span>
            Live Monitoring
          </div>
        </div>

        {system && (
          <section className="resource-grid">
            <ResourceCard
              title="System Memory"
              value={
                `${system.memory_used_mb.toFixed(0)} MB`
              }
              subtitle={
                `of ${system.memory_total_mb.toFixed(0)} MB`
              }
              percent={
                system.memory_percent
              }
              icon="▣"
            />

            <ResourceCard
              title="CPU Cores"
              value={system.cpu_count}
              subtitle="Available CPU cores"
              icon="⚡"
            />

            <ResourceCard
              title="Available Memory"
              value={
                `${system.memory_available_mb.toFixed(0)} MB`
              }
              subtitle="Currently available"
              icon="▤"
            />
          </section>
        )}

        <div className="content-heading">
          <h3>
            Process Overview
          </h3>

          <button
            className="small-action-button"
            onClick={() =>
              setPage("processes")
            }
          >
            View All Processes →
          </button>
        </div>

        <section className="stats-grid">
          <StatCard
            title="Total Processes"
            value={stats.total}
            icon="▦"
            className="total-card"
          />

          <StatCard
            title="Running"
            value={stats.running}
            icon="▶"
            className="running-card"
          />

          <StatCard
            title="Sleeping"
            value={stats.sleeping}
            icon="◷"
            className="sleeping-card"
          />

          <StatCard
            title="Waiting"
            value={stats.waiting}
            icon="◌"
            className="waiting-card"
          />

          <StatCard
            title="Stopped"
            value={stats.stopped}
            icon="Ⅱ"
            className="stopped-card"
          />

          <StatCard
            title="Zombie"
            value={stats.zombie}
            icon="!"
            className="zombie-card"
          />
        </section>

        <section className="dashboard-info-grid">
          <div className="info-card">
            <h3>Data Source</h3>

            <div className="info-source">
              <span className="source-dot"></span>
              Linux <strong>/proc</strong>
            </div>

            <p>
              Process information is collected
              directly from the Linux /proc
              filesystem.
            </p>
          </div>

          <div className="info-card">
            <h3>Monitoring Status</h3>

            <div className="monitoring-status">
              <span className="status-circle"></span>
              System Online
            </div>

            <p>
              The dashboard automatically
              updates process information.
            </p>
          </div>
        </section>
      </>
    );
  };

  // ==========================================================
  // PROCESSES PAGE
  // ==========================================================

  const ProcessesPage = () => {
    return (
      <>
        <div className="page-title">
          <div>
            <h2>Processes</h2>

            <p>
              Monitor and manage running
              Linux processes
            </p>
          </div>

          <div className="process-count">
            {filteredProcesses.length}
            {" "}of{" "}
            {processes.length}
            {" "}processes
          </div>
        </div>

        <section className="process-controls">

          {/* SEARCH BOX */}

          <div className="search-box">
            <span>🔍</span>

            <input
              type="text"
              placeholder="Search PID, process, description or state..."
              value={searchInput}
              onChange={(event) =>
                setSearchInput(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter"
                ) {
                  handleSearch();
                }
              }}
            />

            {searchInput && (
              <button
                className="clear-search"
                onClick={clearSearch}
              >
                ✕
              </button>
            )}
          </div>

          {/* SEARCH FIRST */}

          <button
            className="search-button"
            onClick={handleSearch}
          >
            🔍 Search
          </button>

          {/* REFRESH SECOND */}

          <button
            className="refresh-button"
            onClick={fetchProcesses}
            disabled={loading}
          >
            {loading
              ? "⟳ Refreshing..."
              : "↻ Refresh"}
          </button>

          {/* AUTO REFRESH */}

          <button
            className={
              `auto-button ${
                autoRefresh
                  ? "auto-active"
                  : ""
              }`
            }
            onClick={() =>
              setAutoRefresh(
                !autoRefresh
              )
            }
          >
            {autoRefresh
              ? "Auto: ON"
              : "Auto: OFF"}
          </button>

          {autoRefresh && (
            <select
              className="interval-select"
              value={refreshInterval}
              onChange={(event) =>
                setRefreshInterval(
                  Number(
                    event.target.value
                  )
                )
              }
            >
              <option value="1">
                1 sec
              </option>

              <option value="3">
                3 sec
              </option>

              <option value="5">
                5 sec
              </option>

              <option value="10">
                10 sec
              </option>
            </select>
          )}
        </section>

        {search && (
          <div className="active-search">
            Showing results for:
            <strong>
              {" "}
              "{search}"
            </strong>

            <button
              onClick={clearSearch}
            >
              Clear
            </button>
          </div>
        )}

        <section className="process-section">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th
                    onClick={() =>
                      handleSort("pid")
                    }
                  >
                    PID
                    <SortArrow field="pid" />
                  </th>

                  <th
                    onClick={() =>
                      handleSort("ppid")
                    }
                  >
                    PPID
                    <SortArrow field="ppid" />
                  </th>

                  <th
                    onClick={() =>
                      handleSort("name")
                    }
                  >
                    PROCESS
                    <SortArrow field="name" />
                  </th>

                  <th>
                    DESCRIPTION
                  </th>

                  <th
                    onClick={() =>
                      handleSort("state")
                    }
                  >
                    STATE
                    <SortArrow field="state" />
                  </th>

                  <th
                    onClick={() =>
                      handleSort("cpu_percent")
                    }
                  >
                    CPU
                    <SortArrow field="cpu_percent" />
                  </th>

                  <th
                    onClick={() =>
                      handleSort("memory_mb")
                    }
                  >
                    MEMORY
                    <SortArrow field="memory_mb" />
                  </th>

                  <th>
                    UPTIME
                  </th>

                  <th>
                    ACTIONS
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredProcesses.length > 0
                  ? filteredProcesses.map(
                      (process) => (
                        <tr
                          key={process.pid}
                        >
                          <td>
                            <button
                              className="pid-button"
                              onClick={() =>
                                setSelectedProcess(
                                  process
                                )
                              }
                            >
                              {process.pid}
                            </button>
                          </td>

                          <td className="ppid">
                            {process.ppid}
                          </td>

                          <td>
                            <div className="process-cell">
                              <div className="process-icon">
                                ⚙
                              </div>

                              <span className="process-name">
                                {process.name}
                              </span>
                            </div>
                          </td>

                          <td className="description">
                            {process.description}
                          </td>

                          <td>
                            <span
                              className={
                                `state-badge ${
                                  getStateClass(
                                    process.state
                                  )
                                }`
                              }
                            >
                              <span className="state-dot"></span>
                              {process.state}
                            </span>
                          </td>

                          <td>
                            <div className="usage-cell">
                              <strong>
                                {Number(
                                  process.cpu_percent
                                ).toFixed(1)}
                                %
                              </strong>

                              <div className="mini-progress">
                                <div
                                  className="mini-progress-fill"
                                  style={{
                                    width:
                                      `${Math.min(
                                        process.cpu_percent,
                                        100
                                      )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="memory-cell">
                              <strong>
                                {Number(
                                  process.memory_mb
                                ).toFixed(1)}
                                {" MB"}
                              </strong>

                              <span>
                                {Number(
                                  process.memory_percent
                                ).toFixed(2)}
                                %
                              </span>
                            </div>
                          </td>

                          <td className="uptime">
                            {process.uptime}
                          </td>

                          <td>
                            <div className="action-buttons">
                              <button
                                className="action-stop"
                                title="Stop process"
                                disabled={
                                  actionLoading ===
                                  `stop-${process.pid}`
                                }
                                onClick={() =>
                                  processAction(
                                    process.pid,
                                    "stop"
                                  )
                                }
                              >
                                ⏸
                              </button>

                              <button
                                className="action-resume"
                                title="Resume process"
                                disabled={
                                  actionLoading ===
                                  `resume-${process.pid}`
                                }
                                onClick={() =>
                                  processAction(
                                    process.pid,
                                    "resume"
                                  )
                                }
                              >
                                ▶
                              </button>

                              <button
                                className="action-terminate"
                                title="Terminate process"
                                disabled={
                                  actionLoading ===
                                  `terminate-${process.pid}`
                                }
                                onClick={() =>
                                  processAction(
                                    process.pid,
                                    "terminate"
                                  )
                                }
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    )
                  : (
                    <tr>
                      <td
                        colSpan="9"
                        className="no-processes"
                      >
                        <div>🔍</div>

                        <h3>
                          No processes found
                        </h3>

                        <p>
                          Try a different
                          search term.
                        </p>
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  };

  // ==========================================================
  // TREE PAGE
  // ==========================================================

  const TreePage = () => {
    return (
      <>
        <div className="page-title">
          <div>
            <h2>Process Tree</h2>

            <p>
              Parent and child process
              relationships
            </p>
          </div>

          <div className="process-count">
            {processes.length} processes
          </div>
        </div>

        <section className="tree-section">
          <div className="tree-header">
            <div>
              <h3>
                Process Hierarchy
              </h3>

              <p>
                PID → PPID relationships
              </p>
            </div>

            <span className="tree-source">
              Linux /proc
            </span>
          </div>

          <div className="tree-container">
            {processTree.length > 0
              ? processTree.map(
                  (process) => (
                    <TreeNode
                      key={process.pid}
                      process={process}
                    />
                  )
                )
              : (
                <div className="tree-empty">
                  No process information
                  available.
                </div>
              )}
          </div>
        </section>
      </>
    );
  };

  // ==========================================================
  // SYSTEM PAGE
  // ==========================================================

  const SystemPage = () => {
    if (!system) {
      return (
        <div className="page-title">
          <div>
            <h2>
              System Information
            </h2>

            <p>
              Loading system information...
            </p>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="page-title">
          <div>
            <h2>
              System Information
            </h2>

            <p>
              Linux system resource information
            </p>
          </div>
        </div>

        <section className="system-info-grid">
          <div className="system-info-card">
            <div className="system-info-icon">
              ⚡
            </div>

            <div>
              <span>
                CPU CORES
              </span>

              <strong>
                {system.cpu_count}
              </strong>

              <p>
                Available CPU cores
              </p>
            </div>
          </div>

          <div className="system-info-card">
            <div className="system-info-icon">
              ▣
            </div>

            <div>
              <span>
                TOTAL MEMORY
              </span>

              <strong>
                {system.memory_total_mb.toFixed(0)}
                {" MB"}
              </strong>

              <p>
                Total system memory
              </p>
            </div>
          </div>

          <div className="system-info-card">
            <div className="system-info-icon">
              ▤
            </div>

            <div>
              <span>
                USED MEMORY
              </span>

              <strong>
                {system.memory_used_mb.toFixed(0)}
                {" MB"}
              </strong>

              <p>
                {system.memory_percent.toFixed(1)}
                % of total memory
              </p>
            </div>
          </div>

          <div className="system-info-card">
            <div className="system-info-icon">
              ✓
            </div>

            <div>
              <span>
                AVAILABLE MEMORY
              </span>

              <strong>
                {system.memory_available_mb.toFixed(0)}
                {" MB"}
              </strong>

              <p>
                Currently available
              </p>
            </div>
          </div>
        </section>

        <section className="system-details">
          <h3>
            Process Statistics
          </h3>

          <div className="system-stat-row">
            <span>
              Total Processes
            </span>

            <strong>
              {stats.total}
            </strong>
          </div>

          <div className="system-stat-row">
            <span>
              Running Processes
            </span>

            <strong>
              {stats.running}
            </strong>
          </div>

          <div className="system-stat-row">
            <span>
              Sleeping Processes
            </span>

            <strong>
              {stats.sleeping}
            </strong>
          </div>

          <div className="system-stat-row">
            <span>
              Waiting Processes
            </span>

            <strong>
              {stats.waiting}
            </strong>
          </div>

          <div className="system-stat-row">
            <span>
              Stopped Processes
            </span>

            <strong>
              {stats.stopped}
            </strong>
          </div>

          <div className="system-stat-row">
            <span>
              Zombie Processes
            </span>

            <strong>
              {stats.zombie}
            </strong>
          </div>
        </section>

        <section className="system-source-card">
          <div className="source-large-icon">
            /
          </div>

          <div>
            <h3>
              Data Source
            </h3>

            <p>
              Process and system information
              is collected from the Linux
              <strong> /proc </strong>
              filesystem.
            </p>
          </div>
        </section>
      </>
    );
  };

  // ==========================================================
  // PAGE
  // ==========================================================

  const renderPage = () => {
  if (page === "dashboard") {
    return DashboardPage();
  }

  if (page === "processes") {
    return ProcessesPage();
  }

  if (page === "tree") {
    return TreePage();
  }

  if (page === "system") {
    return SystemPage();
  }

  return DashboardPage();
};

  // ==========================================================
  // MAIN UI
  // ==========================================================

  return (
    <div className="app-layout">

      {/* SIDEBAR */}

      <aside className="sidebar">
        <div className="brand">
          <div>
            <h1>
              Linux Process
            </h1>

            <span>
              Explorer
            </span>
          </div>
        </div>

        <div className="sidebar-section-title">
          MONITORING
        </div>

        <nav>
          {navigationItems.map(
            (item) => (
              <button
                key={item.id}
                className={
                  `nav-item ${
                    page === item.id
                      ? "active-nav"
                      : ""
                  }`
                }
                onClick={() =>
                  setPage(item.id)
                }
              >
                <span className="nav-icon">
                  {item.icon}
                </span>

                <span>
                  {item.label}
                </span>
              </button>
            )
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span></span>

            <div>
              <strong>
                System Online
              </strong>

              <small>
                Linux /proc
              </small>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              Linux Process Explorer
              {" / "}
              {
                navigationItems.find(
                  (item) =>
                    item.id === page
                )?.label
              }
            </span>
          </div>

          <div className="topbar-right">
            {lastUpdated && (
              <span className="last-updated">
                Updated{" "}
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}

            <div className="online-indicator">
              <span></span>
              Online
            </div>
          </div>
        </header>

        <div className="content">

          {message && (
            <div className="success-message">
              <span>
                ✓ {message}
              </span>

              <button
                onClick={() =>
                  setMessage("")
                }
              >
                ✕
              </button>
            </div>
          )}

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          {renderPage()}
        </div>

        <footer>
          <span>
            Linux Process Explorer
          </span>

          <span>
            Process Monitoring and
            Management Tool
          </span>
        </footer>
      </main>

      {/* DETAILS MODAL */}

      {selectedProcess && (
        <div
          className="modal-overlay"
          onClick={() =>
            setSelectedProcess(null)
          }
        >
          <div
            className="details-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  Process Details
                </h2>

                <p>
                  PID{" "}
                  {selectedProcess.pid}
                </p>
              </div>

              <button
                className="modal-close"
                onClick={() =>
                  setSelectedProcess(null)
                }
              >
                ✕
              </button>
            </div>

            <div className="details-grid">
              <div className="detail-item">
                <span>PID</span>

                <strong>
                  {selectedProcess.pid}
                </strong>
              </div>

              <div className="detail-item">
                <span>PPID</span>

                <strong>
                  {selectedProcess.ppid}
                </strong>
              </div>

              <div className="detail-item">
                <span>Process Name</span>

                <strong>
                  {selectedProcess.name}
                </strong>
              </div>

              <div className="detail-item">
                <span>Description</span>

                <strong>
                  {selectedProcess.description}
                </strong>
              </div>

              <div className="detail-item">
                <span>State</span>

                <strong>
                  {selectedProcess.state}
                </strong>
              </div>

              <div className="detail-item">
                <span>CPU Usage</span>

                <strong>
                  {Number(
                    selectedProcess.cpu_percent
                  ).toFixed(2)}
                  %
                </strong>
              </div>

              <div className="detail-item">
                <span>Memory</span>

                <strong>
                  {Number(
                    selectedProcess.memory_mb
                  ).toFixed(2)}
                  {" MB"}
                </strong>
              </div>

              <div className="detail-item">
                <span>Memory %</span>

                <strong>
                  {Number(
                    selectedProcess.memory_percent
                  ).toFixed(2)}
                  %
                </strong>
              </div>

              <div className="detail-item">
                <span>Uptime</span>

                <strong>
                  {selectedProcess.uptime}
                </strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="modal-action stop-modal"
                onClick={() =>
                  processAction(
                    selectedProcess.pid,
                    "stop"
                  )
                }
              >
                ⏸ Stop
              </button>

              <button
                className="modal-action resume-modal"
                onClick={() =>
                  processAction(
                    selectedProcess.pid,
                    "resume"
                  )
                }
              >
                ▶ Resume
              </button>

              <button
                className="modal-action terminate-modal"
                onClick={() =>
                  processAction(
                    selectedProcess.pid,
                    "terminate"
                  )
                }
              >
                ✕ Terminate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
