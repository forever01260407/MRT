const roles = [
  {
    name: "user",
    title: "一般使用者",
    description: "查看日常監測資訊與個人資料。",
    state: "啟用",
    tone: "user",
  },
  {
    name: "userpro",
    title: "進階使用者",
    description: "角色先保留，這一階段不開放指派。",
    state: "暫停",
    tone: "paused",
  },
  {
    name: "supervisor",
    title: "主管",
    description: "查看進階監測內容與主管功能。",
    state: "啟用",
    tone: "supervisor",
  },
  {
    name: "admin",
    title: "系統管理員",
    description: "唯一可以新增帳號與調整使用者角色的人員。",
    state: "管理",
    tone: "admin",
  },
] as const;

export default function AdminAreaPage() {
  return (
    <main className="app-shell admin-area-page">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark admin-brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div>
            <p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p>
            <h1>環狀線鋼軌狀態監測中心</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <a href="/" className="nav-item">潤滑設備總覽</a>
          <a href="/wear" className="nav-item">正面軌道總覽</a>
          <a href="/side-wear" className="nav-item">側面軌道總覽</a>
          <a href="/admin-area" className="nav-item admin-nav-item active" aria-current="page" data-requires-role="admin">ADMIN AREA</a>
        </nav>
        <div className="sync-state admin-sync-state"><span className="admin-lock-dot" aria-hidden="true">◆</span>管理員專用區域</div>
      </header>

      <section className="page-content admin-area-content">
        <div className="page-heading admin-area-heading">
          <div>
            <p className="eyebrow dark">ACCOUNT &amp; ACCESS CONTROL</p>
            <h2>帳號與權限管理</h2>
            <p>集中管理人員帳號、角色與可使用的系統功能。</p>
          </div>
          <div className="admin-access-badge"><span aria-hidden="true">A</span><div><small>目前區域</small><strong>ADMIN ONLY</strong></div></div>
        </div>

        <section className="admin-intro" aria-label="管理區域說明">
          <span className="admin-intro-icon" aria-hidden="true">◎</span>
          <div>
            <strong>登入一次，再依角色決定功能</strong>
            <p>完成登入機制後，只有 admin 會在上方看到 ADMIN AREA，直接輸入網址也會由後端再次驗證。</p>
          </div>
          <span className="admin-intro-state">權限架構確認中</span>
        </section>

        <section className="admin-summary-grid" aria-label="權限設定摘要">
          <article><span>角色總數</span><strong>4</strong><small>user · userpro · supervisor · admin</small></article>
          <article><span>目前啟用</span><strong>3</strong><small>userpro 暫時保留</small></article>
          <article><span>可新增帳號</span><strong>1</strong><small>僅限 admin 角色</small></article>
          <article><span>登入方式</span><strong>1 次</strong><small>登入後不重複輸入功能密碼</small></article>
        </section>

        <div className="admin-workspace-grid">
          <section className="admin-panel role-panel" aria-labelledby="role-title">
            <header className="admin-panel-heading">
              <div><span className="panel-kicker">ROLE DEFINITIONS</span><h3 id="role-title">角色架構</h3></div>
              <span className="admin-panel-count">4 種角色</span>
            </header>
            <div className="role-list">
              {roles.map((role) => (
                <article className={`role-card ${role.tone}`} key={role.name}>
                  <div className="role-code" aria-hidden="true">{role.name === "supervisor" ? "SV" : role.name === "userpro" ? "UP" : role.name.charAt(0).toUpperCase()}</div>
                  <div className="role-copy"><span>{role.name}</span><strong>{role.title}</strong><p>{role.description}</p></div>
                  <span className="role-state">{role.state}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-panel account-panel" aria-labelledby="account-title">
            <header className="admin-panel-heading">
              <div><span className="panel-kicker">ACCOUNT MANAGEMENT</span><h3 id="account-title">人員帳號</h3></div>
              <button type="button" className="admin-create-button" disabled title="登入與角色系統完成後開放">＋ 新增帳號</button>
            </header>
            <div className="account-rule-list">
              <div><span className="rule-index">01</span><div><strong>只有 admin 可以建立帳號</strong><p>新帳號預設為 user，管理員再依實際職責調整。</p></div></div>
              <div><span className="rule-index">02</span><div><strong>使用者不能提升自己的權限</strong><p>角色變更必須由 admin 執行並留下操作紀錄。</p></div></div>
              <div><span className="rule-index">03</span><div><strong>至少保留一個可用的 admin</strong><p>避免管理員全部遭停用後，系統無人可以管理。</p></div></div>
            </div>
            <div className="account-empty-state">
              <span aria-hidden="true">＋</span>
              <strong>帳號資料表尚未啟用</strong>
              <p>下一階段接上登入與資料庫後，這裡會顯示人員、角色、狀態與最後登入時間。</p>
            </div>
          </section>
        </div>

        <section className="admin-next-step" aria-label="下一階段規劃">
          <div><span className="panel-kicker">NEXT AUTHENTICATION PHASE</span><h3>下一步才接登入，不在這一輪硬塞完整帳號系統</h3></div>
          <ol>
            <li><span>1</span><div><strong>建立登入頁</strong><small>帳號與密碼只在登入時輸入一次。</small></div></li>
            <li><span>2</span><div><strong>建立個人頁面</strong><small>所有角色都能查看自己的帳號與修改密碼。</small></div></li>
            <li><span>3</span><div><strong>套用 admin 驗證</strong><small>同時保護導覽、頁面路由與後端 API。</small></div></li>
          </ol>
        </section>
      </section>
    </main>
  );
}
