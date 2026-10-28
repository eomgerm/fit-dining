/* eslint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- Reference animation classes are defined in the colocated CSS, preserving the supplied keyframes. */
import "./signup-intro-motion.css";

// Markup and keyframes are copied from Signup.dc.html; coordinates stay in its 360px canvas.
export function SignupIntroMotion({
  slide,
  playing,
}: {
  slide: number;
  playing: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="signup-motion"
      data-playing={playing ? "" : undefined}
    >
      <div className="signup-motion-stage">
        {slide === 0 && (
          <div className="m1-fd">
            <div
              className="m1-taste-all m1-a1"
              style={{ position: "absolute", inset: "0px" }}
            >
              <div className="m1-tl">
                <i className="m1-tl-fill m1-taste-fill m1-a3"></i>
              </div>
              <div className="m1-tl-lab" style={{ left: "96px" }}>
                3월<b className="m1-taste-lab m1-a5">3월</b>
              </div>
              <div className="m1-tl-node" style={{ left: "96px" }}>
                <i
                  className="m1-tl-on m1-taste-node m1-a7"
                  style={{ opacity: "1" }}
                ></i>
              </div>
              <div className="m1-tl-lab" style={{ left: "180px" }}>
                6월<b className="m1-taste-lab m1-a9">6월</b>
              </div>
              <div className="m1-tl-node" style={{ left: "180px" }}>
                <i className="m1-tl-on m1-taste-node m1-a11"></i>
              </div>
              <div className="m1-tl-lab" style={{ left: "264px" }}>
                9월<b className="m1-taste-lab m1-a13">9월</b>
              </div>
              <div className="m1-tl-node" style={{ left: "264px" }}>
                <i className="m1-tl-on m1-taste-node m1-a15"></i>
              </div>
              <div className="m1-mock">
                <div className="m1-mock-scr">
                  <div className="m1-m-map">
                    <i
                      className="m1-m-road"
                      style={{
                        left: "0",
                        right: "0",
                        top: "46px",
                        height: "10px",
                      }}
                    ></i>
                    <i
                      className="m1-m-road"
                      style={{
                        top: "0",
                        bottom: "0",
                        left: "120px",
                        width: "10px",
                      }}
                    ></i>
                    <i
                      className="m1-m-pin m1-on m1-taste-pa1 m1-a21"
                      style={{ left: "70px", top: "20px" }}
                    >
                      1
                    </i>
                    <i
                      className="m1-m-pin m1-taste-pa2 m1-a22"
                      style={{ left: "70px", top: "20px" }}
                    >
                      2
                    </i>
                    <i
                      className="m1-m-pin m1-taste-pc2 m1-a23"
                      style={{ left: "26px", top: "66px" }}
                    >
                      2
                    </i>
                    <i
                      className="m1-m-pin m1-taste-pb2 m1-a24"
                      style={{ left: "150px", top: "64px" }}
                    >
                      2
                    </i>
                    <i
                      className="m1-m-pin m1-on m1-taste-pb1 m1-a25"
                      style={{ left: "150px", top: "64px" }}
                    >
                      1
                    </i>
                  </div>
                  <div className="m1-m-sheet">
                    <div className="m1-m-q">“조용히 대화하기 좋은 카페”</div>
                    <div className="m1-m-taste">
                      내 취향
                      <span className="m1-v1-swap">
                        <span className="m1-mchip m1-taste-chip m1-a30">
                          조용한 곳
                        </span>
                        <span className="m1-mchip m1-taste-chip m1-a31">
                          대화하기 좋은 곳
                        </span>
                        <span className="m1-mchip m1-taste-chip m1-a32">
                          활기찬 곳
                        </span>
                      </span>
                    </div>
                    <div className="m1-m-cards">
                      <div
                        className="m1-mini m1-taste-ks m1-a34"
                        style={{ top: "68px" }}
                      >
                        <div className="m1-mrow">
                          <div className="m1-ph m1-p3 m1-mthumb"></div>
                          <div>
                            <div className="m1-mname">북카페 소요</div>
                            <div className="m1-mmeta">카페 · 210m</div>
                          </div>
                          <span className="m1-mscore">79</span>
                        </div>
                      </div>
                      <div
                        className="m1-mini m1-taste-ka m1-a41"
                        style={{ top: "0px", zIndex: "2" }}
                      >
                        <div className="m1-mrow">
                          <div className="m1-ph m1-p2 m1-mthumb"></div>
                          <div>
                            <div className="m1-mname">카페 온담</div>
                            <div className="m1-mmeta">카페 · 350m</div>
                          </div>
                          <span
                            className="m1-mscore"
                            style={{ position: "relative" }}
                          >
                            <span className="m1-a47t0">84</span>
                            <span className="m1-a47t1">81</span>
                            <span className="m1-a47t2">76</span>
                          </span>
                        </div>
                      </div>
                      <div
                        className="m1-mini m1-taste-kh m1-a48"
                        style={{ top: "68px", zIndex: "3" }}
                      >
                        <div className="m1-mrow">
                          <div className="m1-ph m1-p4 m1-mthumb"></div>
                          <div>
                            <div className="m1-mname">선릉 하이볼바</div>
                            <div className="m1-mmeta">술집 · 480m</div>
                          </div>
                          <span
                            className="m1-mscore"
                            style={{ position: "relative" }}
                          >
                            <span className="m1-a54t0">80</span>
                            <span className="m1-a54t1">86</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {slide === 1 && (
          <div className="m2-fd">
            <div className="m2-dv m2-sync-a m2-a1">
              <div className="m2-dv-body">
                <div className="m2-dv-scr">
                  <i className="m2-dv-island"></i>
                  <div className="m2-ap">
                    <div className="m2-ap-t">내 취향</div>
                    <div className="m2-ap-chips">
                      <span className="m2-ap-chip m2-a8">조용한 곳</span>
                      <span className="m2-ap-chip m2-a9">대화하기 좋은 곳</span>
                      <span className="m2-ap-chip m2-a10">
                        자리가 넉넉한 곳
                      </span>
                    </div>
                    <div className="m2-ap-card">
                      <i className="m2-ph m2-p2"></i>
                      <div>
                        <div className="m2-ap-name">카페 온담</div>
                        <div className="m2-ap-meta">카페 · 350m</div>
                      </div>
                      <span>84</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="m2-dv m2-gx m2-sync-b m2-a17">
              <div className="m2-dv-body">
                <div className="m2-dv-scr">
                  <i className="m2-dv-hole"></i>
                  <div
                    className="m2-ap-skel m2-sync-skel m2-a21"
                    style={{ overflow: "hidden" }}
                  >
                    <i style={{ width: "40%", height: "18px" }}></i>
                    <i style={{ width: "62%" }}></i>
                    <i style={{ width: "80%" }}></i>
                    <i style={{ width: "74%" }}></i>
                    <i style={{ height: "56px", borderRadius: "12px" }}></i>
                    <span className="m2-sy-shim m2-sync-shim m2-a27"></span>
                  </div>
                  <div className="m2-sync-fill">
                    <div className="m2-ap">
                      <div className="m2-ap-t m2-a30">내 취향</div>
                      <div className="m2-ap-chips">
                        <span className="m2-ap-chip m2-a32">조용한 곳</span>
                        <span className="m2-ap-chip m2-a33">
                          대화하기 좋은 곳
                        </span>
                        <span className="m2-ap-chip m2-a34">
                          자리가 넉넉한 곳
                        </span>
                      </div>
                      <div className="m2-ap-card m2-a35">
                        <i className="m2-ph m2-p2"></i>
                        <div>
                          <div className="m2-ap-name">카페 온담</div>
                          <div className="m2-ap-meta">카페 · 350m</div>
                        </div>
                        <span>84</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <span
              className="m2-ap-chip m2-sy-fly m2-sync-fly m2-a41"
              style={{ top: "182px" }}
            >
              조용한 곳
            </span>
            <span
              className="m2-ap-chip m2-sy-fly m2-sync-fly m2-a42"
              style={{ top: "214px" }}
            >
              대화하기 좋은 곳
            </span>
            <span
              className="m2-ap-chip m2-sy-fly m2-sync-fly m2-a43"
              style={{ top: "246px" }}
            >
              자리가 넉넉한 곳
            </span>
            <svg className="m2-sy-svg" viewBox="0 0 360 404">
              <circle
                className="m2-sync-halo m2-a45"
                cx="180"
                cy="61"
                r="30"
                fill="var(--primary)"
              ></circle>
              <g className="m2-sync-stream m2-a46">
                <rect
                  x="168"
                  y="87"
                  width="24"
                  height="23"
                  rx="12"
                  fill="var(--primary)"
                  opacity=".08"
                ></rect>
                <path
                  className="m2-sync-dash m2-a48"
                  d="M180 110V89"
                  stroke="var(--primary)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeDasharray="1.5 5"
                  fill="none"
                ></path>
              </g>
              <ellipse
                className="m2-sync-rip m2-a49"
                cx="180"
                cy="83"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.5"
              ></ellipse>
              <ellipse
                className="m2-sync-rip m2-a50"
                cx="180"
                cy="83"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.5"
              ></ellipse>
              <ellipse
                className="m2-sync-rip m2-a51"
                cx="180"
                cy="83"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.5"
              ></ellipse>
              <circle
                className="m2-sync-dot m2-a52"
                r="4.5"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              ></circle>
              <circle
                className="m2-sync-dot m2-a53"
                r="3.4000000000000004"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a54"
                r="2.6"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a55"
                r="1.7999999999999998"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a56"
                r="4.5"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              ></circle>
              <circle
                className="m2-sync-dot m2-a57"
                r="3.4000000000000004"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a58"
                r="2.6"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a59"
                r="1.7999999999999998"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a60"
                r="4.5"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              ></circle>
              <circle
                className="m2-sync-dot m2-a61"
                r="3.4000000000000004"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a62"
                r="2.6"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <circle
                className="m2-sync-dot m2-a63"
                r="1.7999999999999998"
                fill="var(--primary)"
                stroke="#FFFFFF"
                strokeWidth="0"
              ></circle>
              <g className="m2-sync-cg m2-a64">
                <g transform="translate(132.5 29) scale(1.25)">
                  <path
                    d="M20 46h38a14 14 0 0 0 1-28 20 20 0 0 0-38-4A16 16 0 0 0 20 46z"
                    fill="#FFFFFF"
                  ></path>
                  <path
                    className="m2-sync-w2 m2-a67"
                    d="M20 46h38a14 14 0 0 0 1-28 20 20 0 0 0-38-4A16 16 0 0 0 20 46z"
                    fill="var(--primary)"
                    opacity=".3"
                  ></path>
                  <path
                    className="m2-sync-w1 m2-a68"
                    d="M20 46h38a14 14 0 0 0 1-28 20 20 0 0 0-38-4A16 16 0 0 0 20 46z"
                    fill="var(--primary)"
                    opacity=".9"
                  ></path>
                  <path
                    d="M24 16a12 9 0 0 1 14-6"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    opacity=".9"
                  ></path>
                  <path
                    d="M20 46h38a14 14 0 0 0 1-28 20 20 0 0 0-38-4A16 16 0 0 0 20 46z"
                    fill="none"
                    stroke="var(--primary-strong)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  ></path>
                </g>
              </g>
              <g className="m2-sync-ck m2-a71">
                <circle
                  cx="216"
                  cy="77"
                  r="9"
                  fill="var(--primary-strong)"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                ></circle>
                <path
                  d="M212 77l3 3 5-6"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                ></path>
              </g>
            </svg>
          </div>
        )}
        {slide === 2 && (
          <div className="m3-fd">
            <div className="m3-cam m3-save-cam">
              <div className="m3-mock">
                <div className="m3-mock-scr">
                  <div className="m3-m-photo m3-save-photo"></div>
                  <span className="m3-m-fab" style={{ left: "10px" }}>
                    <svg className="m3-fd-icon" viewBox="0 0 24 24">
                      <path d="M15 18l-6-6 6-6"></path>
                    </svg>
                  </span>
                  <span
                    className="m3-m-fab m3-save-fab m3-a8"
                    style={{ right: "10px" }}
                  >
                    <svg
                      className="m3-fd-icon"
                      viewBox="0 0 24 24"
                      style={{
                        position: "absolute",
                        color: "var(--ink-muted)",
                      }}
                    >
                      <path d="M6 4h12v17l-6-4-6 4z"></path>
                    </svg>
                    <svg
                      className="m3-fd-icon m3-save-on m3-a11"
                      viewBox="0 0 24 24"
                      style={{
                        position: "absolute",
                        color: "var(--primary-strong)",
                        fill: "var(--primary-strong)",
                      }}
                    >
                      <path d="M6 4h12v17l-6-4-6 4z"></path>
                    </svg>
                  </span>
                  <div className="m3-m-body">
                    <div className="m3-m-cap">카페 · 350m</div>
                    <div className="m3-m-name">카페 온담</div>
                    <div className="m3-m-open">
                      <b>영업 중</b> · 오늘 22:00까지
                    </div>
                    <div
                      style={{ display: "flex", gap: "4px", marginTop: "8px" }}
                    >
                      <span className="m3-fd-tag-match">
                        조용하고 차분한 곳
                      </span>
                    </div>
                  </div>
                  <div className="m3-m-tabs">
                    <b>홈</b>
                    <span>메뉴</span>
                    <span>리뷰</span>
                    <span>정보</span>
                  </div>
                  <span className="m3-v3-toast m3-save-toast m3-a25">
                    <svg className="m3-fd-icon" viewBox="0 0 24 24">
                      <path d="M5 12l5 5 9-10"></path>
                    </svg>
                    저장했어요
                  </span>
                </div>
              </div>
              <i
                className="m3-save-dot m3-a28"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a29"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a30"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a31"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a32"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a33"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a34"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i
                className="m3-save-dot m3-a35"
                style={{
                  position: "absolute",
                  left: "254px",
                  top: "146px",
                  width: "5px",
                  height: "5px",
                  margin: "-2.5px 0px 0px -2.5px",
                  borderRadius: "3px",
                  background: "var(--primary)",
                  zIndex: "18",
                }}
              ></i>
              <i className="m3-tring m3-save-ring m3-a36"></i>
              <i className="m3-tring m3-save-ring m3-a37"></i>
              <i className="m3-tch m3-save-touch m3-a38"></i>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
