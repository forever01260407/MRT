import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="forbidden-page">
      <section>
        <span className="forbidden-code">403</span>
        <p className="eyebrow dark">ROLE RESTRICTED</p>
        <h1>這個帳號沒有足夠權限</h1>
        <p>你已經登入，但目前角色未被授權使用這個功能。</p>
        <div><Link href="/">返回監測總覽</Link><Link className="secondary" href="/login">改用其他帳號登入</Link></div>
      </section>
    </main>
  );
}
