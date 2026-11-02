"""`.gitlab-ci.yml`의 구조 규칙(계획 1C-3 Task 5).

GitLab 없이 `rules:`를 평가해서 파이프라인마다 어떤 잡이 나타나는지 본다. PyYAML이 필요하다(lint:guards가 py3-yaml을 설치한다).
배포 스위치(FIT_CD_ENABLED)를 바꾸는 MR은 이 파일의 스위치 시험도 함께 바꿔야 한다. 그래서 실수로 켜거나 끄지 못한다.
"""
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CI = yaml.safe_load((ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8"))

RESERVED = {"stages", "workflow", "default", "variables", "include", "image", "services", "cache", "before_script", "after_script"}
VERIFY_JOBS = ["be:test", "fe:scope", "fe:check", "be:build", "fe:bundle-check"]
BRANCH_VERIFY_JOBS = [j for j in VERIFY_JOBS if j != "fe:scope"]  # fe:scope는 MR 전용이다(develop·master는 전체 시험)
ALWAYS_IN_MR = {"lint:guards", "lint:secrets", "lint:history"}  # 경로와 상관없이 모든 MR에서 도는 잡. MR에 파이프라인이 없으면 병합할 수 없다
DEPLOY_TAGGED = ["build:images", "deploy:dev", "deploy:prod", "smoke:dev", "smoke:prod"]
NEW_JOBS = VERIFY_JOBS + DEPLOY_TAGGED
PROTECTED = {"develop", "master"}

_TOKEN = re.compile(r'\s*(&&|\|\||==|!=|\(|\)|\$[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|null)')


def evaluate(expr: str, variables: dict) -> bool:
    """GitLab `rules:if` 식 중 이 파일이 쓰는 부분(변수, 문자열, null, ==, !=, &&, ||, 괄호). 그 밖의 문법은 오류로 알린다."""
    text = expr.strip()
    toks, pos = [], 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"시험이 모르는 규칙 문법: {text[pos:pos + 20]!r}")
        toks.append(m.group(1))
        pos = m.end()
    i = 0

    def peek():
        return toks[i] if i < len(toks) else None

    def take():
        nonlocal i
        t = toks[i]
        i += 1
        return t

    def operand():
        t = take()
        if t.startswith("$"):
            return variables.get(t[1:])
        if t == "null":
            return None
        if t.startswith('"'):
            return t[1:-1]
        raise ValueError(f"피연산자가 아니다: {t}")

    def comparison():
        if peek() == "(":
            take()
            v = or_expr()
            if take() != ")":
                raise ValueError("괄호가 닫히지 않았다")
            return v
        left = operand()
        if peek() in ("==", "!="):
            op = take()
            right = operand()
            return (left == right) if op == "==" else (left != right)
        return bool(left)

    def and_expr():
        v = comparison()
        while peek() == "&&":
            take()
            r = comparison()
            v = v and r
        return v

    def or_expr():
        v = and_expr()
        while peek() == "||":
            take()
            r = and_expr()
            v = v or r
        return v

    result = or_expr()
    if i != len(toks):
        raise ValueError("식 끝에 남은 토큰이 있다")
    return bool(result)


def job_names() -> list[str]:
    return [n for n, v in CI.items() if n not in RESERVED and not n.startswith(".") and isinstance(v, dict)]


def effective(name: str) -> dict:
    """extends와 default를 합친 잡(얕은 병합. 이 시험이 보는 키는 모두 덮어쓰기 규칙이다)."""
    job = CI[name]
    merged: dict = {}
    parents = job.get("extends") or []
    for p in [parents] if isinstance(parents, str) else parents:
        merged.update(effective(p))
    merged.update(job)
    for k, v in (CI.get("default") or {}).items():
        merged.setdefault(k, v)
    return merged


def glob_to_regex(pattern: str) -> re.Pattern:
    """GitLab `rules:changes`의 glob(`*`은 /를 넘지 않고 `**`는 디렉터리를 넘는다, `{a,b}`, 점 파일 포함)을 정규식으로 바꾼다."""
    i, out = 0, ""
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
            continue
        c = pattern[i]
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        elif c == "{":
            j = pattern.index("}", i)
            out += "(?:" + "|".join(re.escape(x) for x in pattern[i + 1:j].split(",")) + ")"
            i = j
        else:
            out += re.escape(c)
        i += 1
    return re.compile(out + r"\Z")


def paths_match(patterns, changed) -> bool:
    if changed is None:  # 바뀐 파일을 모르면(브랜치 파이프라인 등) 맞는 것으로 본다
        return True
    if isinstance(patterns, dict):
        patterns = patterns["paths"]
    regexes = [glob_to_regex(p) for p in patterns]
    return any(r.match(f) for f in changed for r in regexes)


def first_match(rules: list, variables: dict, changed=None):
    for rule in rules:
        if "if" in rule and not evaluate(rule["if"], variables):
            continue
        if "changes" in rule and not paths_match(rule["changes"], changed):
            continue
        return rule.get("when", "on_success")
    return None


def pipeline(variables: dict, changed=None) -> dict[str, str]:
    """{잡 이름: when}. 파이프라인이 만들어지지 않으면 빈 사전이다. changed는 MR이 바꾼 파일(None이면 모른다)."""
    if first_match(CI["workflow"]["rules"], variables) in (None, "never"):
        return {}
    out: dict[str, str] = {}
    for name in job_names():
        job = effective(name)
        when = first_match(job["rules"], variables, changed) if "rules" in job else "on_success"
        if when not in (None, "never"):
            out[name] = when
    return out


def context(kind: str, switch: str | None = None) -> dict:
    v = {k: str(val) for k, val in CI["variables"].items()}
    if switch is not None:
        v["FIT_CD_ENABLED"] = switch
    if kind in ("develop", "master"):
        v.update(CI_PIPELINE_SOURCE="push", CI_COMMIT_BRANCH=kind)
    elif kind == "feature-push":
        v.update(CI_PIPELINE_SOURCE="push", CI_COMMIT_BRANCH="fe/feat/login-S15P31A302-38")
    elif kind == "mr":
        v.update(CI_PIPELINE_SOURCE="merge_request_event", CI_MERGE_REQUEST_SOURCE_BRANCH_NAME="fe/feat/login-S15P31A302-38")
    elif kind == "mr-from-develop":
        v.update(CI_PIPELINE_SOURCE="merge_request_event", CI_MERGE_REQUEST_SOURCE_BRANCH_NAME="develop")
    else:
        raise ValueError(kind)
    return v


KINDS = ["develop", "master", "mr", "mr-from-develop", "feature-push"]


def script_text(name: str) -> str:
    return "\n".join(str(line) for line in effective(name).get("script", []))


class EvaluatorTest(unittest.TestCase):
    def test_comparisons_and_boolean_operators(self):
        v = {"A": "x", "B": "y"}
        self.assertTrue(evaluate('$A == "x"', v))
        self.assertFalse(evaluate('$A == "y"', v))
        self.assertTrue(evaluate('$A != "y"', v))
        self.assertTrue(evaluate('$A == "x" && $B == "y"', v))
        self.assertFalse(evaluate('$A == "x" && $B == "z"', v))
        self.assertTrue(evaluate('$A == "z" || $B == "y"', v))
        self.assertTrue(evaluate('$A == "z" || $B == "z" || $A == "x"', v))

    def test_and_binds_tighter_than_or_and_parentheses_override(self):
        v = {"A": "1", "B": "2", "C": "3"}
        self.assertTrue(evaluate('$A == "1" || $B == "x" && $C == "x"', v))
        self.assertFalse(evaluate('($A == "1" || $B == "x") && $C == "x"', v))

    def test_a_missing_variable_is_null(self):
        self.assertFalse(evaluate('$NOPE == "x"', {}))
        self.assertTrue(evaluate('$NOPE != "x"', {}))
        self.assertTrue(evaluate("$NOPE == null", {}))
        self.assertFalse(evaluate("$NOPE", {}))
        self.assertTrue(evaluate("$A", {"A": "x"}))

    def test_unsupported_syntax_is_reported_instead_of_guessed(self):
        with self.assertRaises(ValueError):
            evaluate('$A =~ /x/', {"A": "x"})


class JobsTest(unittest.TestCase):
    def test_the_ten_jobs_exist(self):
        # fe:test와 fe:build는 fe:check 하나로 합쳤다(컨테이너 기동, 설치, 무거운 잡 줄을 한 번만 쓴다). fe:scope는 MR에서 관련 시험만 고른다
        for name in NEW_JOBS:
            self.assertIn(name, CI, name)
        self.assertEqual(len(NEW_JOBS), 10)
        for gone in ("fe:test", "fe:build"):
            self.assertNotIn(gone, CI, gone)

    def test_deploy_stage_jobs_use_the_deploy_runner_fe_check_uses_the_fe_runner_and_the_rest_use_verify(self):
        for name in job_names():
            tags = effective(name).get("tags")
            if name in DEPLOY_TAGGED:
                self.assertEqual(tags, ["deploy"], name)
            elif name == "fe:check":
                # A의 FE 검사 전용 러너. docker.sock이 없는 러너라 FE 검사 말고는 이 태그를 쓰지 않는다
                self.assertEqual(tags, ["verify-fe"], name)
            else:
                self.assertEqual(tags, ["verify"], name)

    def test_stages(self):
        want = {"be:test": "verify", "fe:scope": "verify", "fe:check": "verify", "be:build": "verify", "fe:bundle-check": "verify",
                "build:images": "build", "deploy:dev": "deploy", "deploy:prod": "deploy", "smoke:dev": "smoke", "smoke:prod": "smoke"}
        for name, stage in want.items():
            self.assertEqual(effective(name).get("stage"), stage, name)
        for name in job_names():
            self.assertIn(effective(name).get("stage"), CI["stages"], name)

    def test_deploy_jobs_have_a_matching_environment_and_resource_group(self):
        for env in ("dev", "prod"):
            job = CI[f"deploy:{env}"]
            self.assertEqual(job["environment"]["name"], env)
            self.assertEqual(job["resource_group"], env)

    def test_deploy_rules_name_the_branch_and_the_switch(self):
        dev, prod = CI["deploy:dev"]["rules"], CI["deploy:prod"]["rules"]
        self.assertEqual(len(dev), 1)
        self.assertEqual(len(prod), 1)
        for rule, branch in ((dev[0], "develop"), (prod[0], "master")):
            self.assertIn('$FIT_CD_ENABLED == "true"', rule["if"])
            self.assertIn(f'$CI_COMMIT_BRANCH == "{branch}"', rule["if"])
        self.assertNotIn("when", dev[0])
        self.assertEqual(prod[0].get("when"), "manual")

    def test_prod_deploy_blocks_the_pipeline_until_a_person_presses_it(self):
        # when: manual은 allow_failure가 기본 true라 누르지 않아도 파이프라인이 통과한 것처럼 보인다. prod는 멈춰 있어야 한다
        self.assertIs(effective("deploy:prod").get("allow_failure"), False)

    def test_switch_is_on(self):
        # 2026-10-26에 켰다. 파일의 값을 바꾸는 MR은 이 시험도 바꿔야 한다. 비상으로 끄는 길은 프로젝트 CI/CD 변수다
        self.assertEqual(CI["variables"]["FIT_CD_ENABLED"], "true")

    def test_deploy_jobs_clone_the_full_history(self):
        # 얕은 clone이면 현재 배포된 커밋이 범위 밖일 때 다운그레이드 가드(merge-base)와 마이그레이션 비교(git diff)가 틀린다
        for name in ("deploy:dev", "deploy:prod"):
            self.assertEqual(effective(name).get("variables", {}).get("GIT_DEPTH"), "0", name)

    def test_interruptible_is_only_on_verify_stage_jobs(self):
        for name in job_names():
            job = effective(name)
            if job.get("interruptible"):
                self.assertEqual(job["stage"], "verify", name)
        for name in DEPLOY_TAGGED:
            self.assertFalse(effective(name).get("interruptible"), name)

    def test_every_image_comes_from_a_defined_variable(self):
        for name in job_names():
            image = effective(name).get("image")
            if name in DEPLOY_TAGGED:
                self.assertIsNone(image, f"{name}은 shell 러너라 image가 없다")
                continue
            ref = image["name"] if isinstance(image, dict) else image
            self.assertIsNotNone(ref, name)
            m = re.fullmatch(r"\$([A-Z0-9_]+_IMAGE)", ref)
            self.assertIsNotNone(m, f"{name}: image는 $..._IMAGE 변수여야 한다({ref})")
            self.assertIn(m.group(1), CI["variables"], name)

    def test_artifacts_carry_the_jar_and_the_bundle(self):
        self.assertIn("be/build/libs/*.jar", effective("be:build")["artifacts"]["paths"])
        self.assertIn("fe-bundle/", effective("fe:check")["artifacts"]["paths"])
        build_needs = effective("build:images")["needs"]
        self.assertIn({"job": "be:build", "artifacts": True}, build_needs)
        self.assertIn({"job": "fe:check", "artifacts": True}, build_needs)
        self.assertIn("fe:bundle-check", build_needs)
        self.assertIn({"job": "fe:check", "artifacts": True}, effective("fe:bundle-check")["needs"])

    def test_scripts_pass_the_commit_sha(self):
        self.assertIn('DEPLOYMENT_VERSION="$CI_COMMIT_SHA" pnpm build', script_text("fe:check"))
        self.assertIn('check_fe_bundle.py fe-bundle --sha "$CI_COMMIT_SHA"', script_text("fe:bundle-check"))
        self.assertIn('build-images.sh "$CI_COMMIT_SHA"', script_text("build:images"))
        for env in ("dev", "prod"):
            self.assertIn(f'deploy.sh {env} "$CI_COMMIT_SHA"', script_text(f"deploy:{env}"))
            self.assertIn(f'smoke.sh {env} --sha "$CI_COMMIT_SHA"', script_text(f"smoke:{env}"))

    def test_files_named_in_scripts_exist(self):
        for name in NEW_JOBS:
            for path in re.findall(r"infra/[A-Za-z0-9_./-]+", script_text(name)):
                self.assertTrue((ROOT / path).exists(), f"{name}: {path}")

    def test_gradle_runs_through_sh_because_the_wrapper_is_not_executable_in_git(self):
        for name in ("be:test", "be:build"):
            script = effective(name)["script"]
            self.assertTrue(any(line.startswith("sh ./gradlew") or line.startswith("sh gradlew") for line in script), script)
            self.assertFalse(any(line.startswith("./gradlew") for line in script), script)

    def test_the_jar_is_built_apart_from_the_tests_and_never_uploaded_by_the_test_job(self):
        # MR마다 55MB jar를 GitLab에 올리면 느리고 서버가 흔들릴 때 테스트까지 같이 실패한다(2026-10-23, 502). jar는 배포할 때만 만든다
        test, build = effective("be:test"), effective("be:build")
        self.assertNotIn("bootJar", script_text("be:test"))
        self.assertNotIn("paths", test.get("artifacts", {}))
        self.assertIn("bootJar -x test", script_text("be:build"))
        self.assertIn("be:test", build["needs"])
        self.assertNotIn("services", build)  # -x test라 DB가 필요 없다

    def test_heavy_jobs_queue_per_side_so_one_be_and_one_fe_job_run_at_the_same_time(self):
        # 메모리를 많이 쓰는 잡은 BE끼리, FE끼리 줄을 세운다. BE 하나와 FE 하나는 동시에 돈다. B(RAM 3.8GB)에서 잡 하나는 최대 1.5~1.6GB였고
        # 둘이 겹치면 스왑을 조금 쓴다(2026-11-02 측정). 같은 쪽의 잡 둘이 겹치면 3.2GB가 넘어 그렇게 하지 않는다
        groups = {"be:test": "verify-heavy-be", "be:build": "verify-heavy-be", "fe:check": "verify-heavy-fe"}
        for name, group in groups.items():
            self.assertEqual(effective(name).get("resource_group"), group, name)
        self.assertNotEqual(groups["be:test"], groups["fe:check"])
        for name in job_names():
            if name not in groups:
                self.assertNotIn(effective(name).get("resource_group"), set(groups.values()), name)

    def test_path_filtered_jobs_rerun_when_the_ci_config_changes_and_branches_run_everything(self):
        filtered = []
        for name in job_names():
            rules = effective(name).get("rules") or []
            mr_rules = [r for r in rules if "changes" in r and "merge_request_event" in r.get("if", "") and "!=" not in r.get("if", "")]
            if not mr_rules:
                continue
            filtered.append(name)
            for rule in mr_rules:
                self.assertIn(".gitlab-ci.yml", rule["changes"], f"{name}: CI 설정을 바꾸면 이 잡도 다시 돌아야 한다")
            if name not in ("lint:migrations", "fe:scope"):  # 이 잡들은 MR 전용이다
                on_branches = [r for r in rules if '$CI_PIPELINE_SOURCE != "merge_request_event"' in r.get("if", "") and "changes" not in r]
                self.assertTrue(on_branches, f"{name}: develop·master에서는 경로와 상관없이 항상 돈다")
        self.assertGreaterEqual(len(filtered), 8)

    def test_the_always_on_jobs_have_no_path_filter(self):
        for name in ALWAYS_IN_MR:
            for rule in effective(name).get("rules") or []:
                self.assertNotIn("changes", rule, name)

    def test_be_tests_start_their_own_database_and_get_no_ambient_one(self):
        # DB가 필요한 BE 시험은 Testcontainers(PostgresTestSupport)가 직접 띄운다. 잡에 DB 서비스나 접속 환경변수를 주면
        # 시험이 코드로 넣은 값이 환경변수에 가려질 수 있다(a0f4be5: 기동 거부 시험이 CI의 SPRING_DATASOURCE_URL에 가려졌다).
        job = effective("be:test")
        self.assertNotIn("services", job)
        leaked = sorted(k for k in job.get("variables", {}) if k.startswith(("SPRING_DATASOURCE_", "POSTGRES_")))
        self.assertEqual(leaked, [], "be:test에 DB 접속 환경변수를 주지 않는다")

    def test_mr_pipelines_only_read_the_be_and_fe_caches_and_branches_update_them(self):
        # 잡마다 캐시(pnpm 스토어 약 580MB 등)를 묶어 올리는 시간을 줄인다. MR은 읽기만(pull) 하고 develop·master가 갱신(pull-push)한다
        for name, var in (("be:test", "BE_CACHE_POLICY"), ("fe:check", "FE_CACHE_POLICY")):
            job = effective(name)
            self.assertEqual(job["cache"]["policy"], "$" + var, name)
            self.assertEqual(job["variables"][var], "pull-push", f"{name}: 기본은 갱신이다(develop·master)")
            mr_rules = [r for r in job["rules"] if "merge_request_event" in r.get("if", "") and "!=" not in r.get("if", "")]
            self.assertTrue(mr_rules, name)
            for rule in mr_rules:
                self.assertEqual(rule.get("variables", {}).get(var), "pull", f"{name}: MR은 캐시를 읽기만 한다")

    def test_fe_check_caches_eslint_tsc_and_next_and_runs_eslint_with_its_cache(self):
        job = effective("fe:check")
        for path in (".pnpm-store", "fe/.eslintcache", "fe/tsconfig.tsbuildinfo", "fe/.next/cache"):
            self.assertIn(path, job["cache"]["paths"], path)
        self.assertIn("pnpm lint --cache", script_text("fe:check"))

    def test_fe_scope_runs_exactly_when_fe_check_runs_in_an_mr_and_never_on_branches(self):
        # fe:check는 fe:scope의 결과를 기다린다(없으면 전체 시험). 둘의 MR 규칙이 어긋나면 MR에서 관련 시험 선택이 조용히 꺼진다
        def mr_changes(name):
            return [r["changes"] for r in effective(name)["rules"] if "merge_request_event" in r.get("if", "") and "!=" not in r.get("if", "")]
        self.assertEqual(mr_changes("fe:scope"), mr_changes("fe:check"))
        for rule in effective("fe:scope")["rules"]:
            self.assertNotIn("!=", rule.get("if", ""), "fe:scope는 MR 전용이다")
        needs = effective("fe:check")["needs"]
        self.assertIn({"job": "fe:scope", "artifacts": True, "optional": True}, needs)
        self.assertEqual(effective("fe:scope")["artifacts"]["reports"]["dotenv"], "fe-scope.env")

    def test_fe_check_runs_all_tests_unless_the_scope_says_otherwise(self):
        text = script_text("fe:check")
        self.assertIn('"${FE_TEST_FULL:-true}" = "true"', text)  # 변수가 없으면 전체다(develop·master)
        self.assertIn("pnpm test", text)
        self.assertIn("vitest related --run --passWithNoTests $FE_TEST_FILES", text)
        self.assertIn("set -f", text)  # [env] 같은 경로가 글롭으로 풀리지 않게 한다

    def test_fe_generates_next_types_before_type_checking(self):
        # Next 16의 LayoutProps 같은 전역 타입은 typegen이나 build가 만든다. 먼저 만들지 않으면 tsc가 실패한다
        lines = effective("fe:check")["script"]
        typegen = next(i for i, l in enumerate(lines) if "next typegen" in l)
        tsc = next(i for i, l in enumerate(lines) if "tsc --noEmit" in l)
        self.assertLess(typegen, tsc)

    def test_shellcheck_runs_in_parallel_and_still_fails_when_any_file_fails(self):
        # 한 프로세스로 57개를 검사하면 B에서 1분 26초였다. xargs -P는 한 배치라도 실패하면 종료 코드 123이라 오류를 놓치지 않는다
        script = script_text("lint:shell")
        self.assertRegex(script, r"xargs -0 -r -P [2-9] -n \d+ shellcheck -x")
        self.assertIn("find infra -type f -name '*.sh' -print0", script)

    def test_lint_guards_installs_pyyaml_for_this_file(self):
        self.assertIn("py3-yaml", "\n".join(effective("lint:guards")["before_script"]))


class PipelineContentsTest(unittest.TestCase):
    def new_jobs(self, kind, switch=None):
        return {n: w for n, w in pipeline(context(kind, switch)).items() if n in NEW_JOBS}

    def test_with_the_switch_off_only_the_tests_appear_everywhere(self):
        for kind in ("develop", "master", "mr"):
            want = ["be:test", "fe:check", "fe:scope"] if kind == "mr" else ["be:test", "fe:check"]  # fe:scope는 MR에서만 관련 시험을 고른다
            self.assertEqual(sorted(self.new_jobs(kind, "false")), want, kind)

    def test_no_pipeline_for_a_plain_branch_push_or_a_develop_to_master_mr(self):
        for kind in ("feature-push", "mr-from-develop"):
            for switch in (None, "true"):
                self.assertEqual(pipeline(context(kind, switch)), {}, kind)

    def test_switch_on_develop_runs_everything_up_to_dev_smoke(self):
        jobs = self.new_jobs("develop", "true")
        self.assertEqual(sorted(jobs), sorted(BRANCH_VERIFY_JOBS + ["build:images", "deploy:dev", "smoke:dev"]))
        self.assertEqual(jobs["deploy:dev"], "on_success")

    def test_switch_on_master_waits_for_a_person_before_prod(self):
        jobs = self.new_jobs("master", "true")
        self.assertEqual(sorted(jobs), sorted(BRANCH_VERIFY_JOBS + ["build:images", "deploy:prod", "smoke:prod"]))
        self.assertEqual(jobs["deploy:prod"], "manual")

    def test_switch_on_mr_runs_the_checks_but_never_builds_the_jar(self):
        self.assertEqual(sorted(self.new_jobs("mr", "true")), sorted(set(VERIFY_JOBS) - {"be:build"}))

    def test_deploy_stage_jobs_never_appear_outside_protected_branches(self):
        for kind in KINDS:
            for switch in (None, "true"):
                ctx = context(kind, switch)
                present = pipeline(ctx)
                tagged = [n for n in present if n in DEPLOY_TAGGED]
                if tagged:
                    self.assertIn(ctx.get("CI_COMMIT_BRANCH"), PROTECTED, f"{kind}: {tagged}")

    def test_needs_point_at_jobs_that_run_in_the_same_pipeline_and_not_a_later_stage(self):
        order = {s: i for i, s in enumerate(CI["stages"])}
        for kind in KINDS:
            for switch in (None, "true"):
                present = pipeline(context(kind, switch))
                for name in present:
                    for need in effective(name).get("needs", []):
                        target = need["job"] if isinstance(need, dict) else need
                        optional = isinstance(need, dict) and need.get("optional")
                        label = f"{kind}/{switch}: {name} -> {target}"
                        if not optional:
                            self.assertIn(target, present, label)
                        if target in present:
                            self.assertLessEqual(order[effective(target)["stage"]], order[effective(name)["stage"]], label)


class GlobTest(unittest.TestCase):
    def matches(self, pattern, path):
        return bool(glob_to_regex(pattern).match(path))

    def test_star_stays_inside_a_directory_and_double_star_crosses_them(self):
        self.assertTrue(self.matches("be/**/*", "be/src/main/java/X.java"))
        self.assertTrue(self.matches("be/**/*", "be/gradlew"))
        self.assertFalse(self.matches("be/**/*", "fe/src/x.ts"))
        self.assertTrue(self.matches("infra/**/*.sh", "infra/deploy/deploy.sh"))
        self.assertTrue(self.matches("infra/**/*.sh", "infra/x.sh"))
        self.assertFalse(self.matches("infra/**/*.sh", "infra/deploy/README.md"))
        self.assertFalse(self.matches("infra/*.sh", "infra/deploy/deploy.sh"))

    def test_dockerfile_patterns_and_dot_files(self):
        for path in ("infra/app/Dockerfile", "infra/app/Dockerfile.fe", "be/x/api.Dockerfile", "Dockerfile"):
            self.assertTrue(any(self.matches(p, path) for p in ("**/Dockerfile", "**/Dockerfile.*", "**/*.Dockerfile")), path)
        self.assertTrue(self.matches(".gitlab-ci.yml", ".gitlab-ci.yml"))
        self.assertFalse(self.matches(".gitlab-ci.yml", "x/.gitlab-ci.yml"))
        self.assertTrue(self.matches("infra/**/*", "infra/.hidden/x"))

    def test_an_unknown_change_set_matches_everything_and_an_empty_one_nothing(self):
        self.assertTrue(paths_match(["fe/**/*"], None))
        self.assertFalse(paths_match(["fe/**/*"], []))


class MrPathTest(unittest.TestCase):
    """MR 파이프라인이 바뀐 경로만 돌리는지. develop·master는 항상 전체다."""

    def mr(self, changed, switch=None):
        return set(pipeline(context("mr", switch), changed))

    def test_docs_only_runs_just_the_always_on_jobs(self):
        self.assertEqual(self.mr(["docs/infra/design.md"]), ALWAYS_IN_MR)
        self.assertEqual(self.mr(["README.md"]), ALWAYS_IN_MR)

    def test_fe_only_runs_the_fe_test_and_nothing_from_be_or_infra(self):
        self.assertEqual(self.mr(["fe/src/app/page.tsx"], "false"), ALWAYS_IN_MR | {"fe:scope", "fe:check"})
        self.assertEqual(self.mr(["fe/src/app/page.tsx"], "true"), ALWAYS_IN_MR | {"fe:scope", "fe:check", "fe:bundle-check"})

    def test_be_only_runs_the_be_test_and_the_migration_check_only_for_migrations(self):
        self.assertEqual(self.mr(["be/src/main/java/kr/co/fitdining/api/X.java"]), ALWAYS_IN_MR | {"be:test"})
        self.assertEqual(self.mr(["be/src/main/resources/db/migration/V2__x.sql"]), ALWAYS_IN_MR | {"be:test", "lint:migrations"})

    def test_infra_changes_run_only_the_linters_that_read_those_files(self):
        self.assertEqual(self.mr(["infra/deploy/deploy.sh"]), ALWAYS_IN_MR | {"lint:shell"})
        self.assertEqual(self.mr(["infra/edge/Caddyfile"]), ALWAYS_IN_MR | {"lint:caddy"})
        self.assertEqual(self.mr(["infra/app/Dockerfile.fe"]), ALWAYS_IN_MR | {"lint:docker"})
        self.assertEqual(
            self.mr(["infra/obs/compose.obs.yml"]),
            ALWAYS_IN_MR | {"lint:yaml", "lint:prometheus", "lint:alertmanager", "lint:image-arch"},
        )
        # A의 관측(infra/obs)과 B의 감시(infra/ops)는 같은 두 린터가 본다. 어느 쪽만 바꿔도 돌아야 한다
        for path in ("infra/ops/alertmanager/alertmanager.yml", "infra/obs/alertmanager/alertmanager.yml"):
            self.assertEqual(self.mr([path]), ALWAYS_IN_MR | {"lint:yaml", "lint:prometheus", "lint:alertmanager"}, path)

    def test_changing_the_ci_config_reruns_everything_that_can_run_in_an_mr(self):
        everything = set(pipeline(context("mr", "true"), None)) - {"lint:image-arch"}
        self.assertEqual(self.mr([".gitlab-ci.yml"], "true"), everything)

    def test_a_bundle_check_script_change_runs_the_bundle_jobs_only_when_the_switch_is_on(self):
        # fe:bundle-check는 fe:check의 번들을 기다리므로 같은 변경에서 둘이 함께 나타나야 한다(없는 잡을 기다리면 파이프라인이 만들어지지 않는다)
        got = self.mr(["infra/ci/check_fe_bundle.py"], "true")
        self.assertIn("fe:scope", got)
        self.assertIn("fe:check", got)
        self.assertIn("fe:bundle-check", got)
        self.assertEqual(self.mr(["infra/ci/check_fe_bundle.py"], "false"), ALWAYS_IN_MR)

    def test_an_mr_pipeline_is_never_empty_whatever_changed(self):
        samples = [[], ["README.md"], ["docs/a.md"], ["fe/a.ts"], ["be/a.java"], ["infra/ci/tests/test_x.py"], ["ai/main.py"], ["some/new/dir/file.txt"]]
        for changed in samples:
            for switch in (None, "true"):
                got = self.mr(changed, switch)
                self.assertTrue(ALWAYS_IN_MR <= got, f"{changed}: {got}")

    def test_branch_pipelines_run_every_path_filtered_job_regardless_of_paths(self):
        for kind in ("develop", "master"):
            got = set(pipeline(context(kind), []))
            for name in ("be:test", "fe:check", "lint:shell", "lint:docker", "lint:caddy", "lint:prometheus", "lint:alertmanager", "lint:yaml", "lint:guards", "lint:secrets"):
                self.assertIn(name, got, f"{kind}: {name}")

    def test_needs_stay_valid_for_every_kind_of_change(self):
        # 존재하지 않는 잡을 기다리면 GitLab이 파이프라인 생성을 거부한다
        samples = [[], ["docs/a.md"], ["fe/a.ts"], ["be/a.java"], ["infra/ci/check_fe_bundle.py"], ["infra/ci/tool-images.sh"], [".gitlab-ci.yml"], ["infra/deploy/deploy.sh"]]
        for kind in ("mr", "develop", "master"):
            for switch in (None, "true"):
                for changed in samples:
                    present = pipeline(context(kind, switch), changed)
                    for name in present:
                        for need in effective(name).get("needs", []):
                            target = need["job"] if isinstance(need, dict) else need
                            optional = isinstance(need, dict) and need.get("optional")
                            if not optional:
                                self.assertIn(target, present, f"{kind}/{switch}/{changed}: {name} -> {target}")


if __name__ == "__main__":
    unittest.main()
