"""`.gitlab-ci.yml`의 구조 규칙(계획 1C-3 Task 5).

GitLab 없이 `rules:`를 평가해서 파이프라인마다 어떤 잡이 나타나는지 본다. PyYAML이 필요하다(lint:guards가 py3-yaml을 설치한다).
배포 스위치(FIT_CD_ENABLED)를 켜는 MR은 이 파일의 기본값 시험도 함께 바꿔야 한다. 그래서 실수로 켜지 못한다.
"""
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CI = yaml.safe_load((ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8"))

RESERVED = {"stages", "workflow", "default", "variables", "include", "image", "services", "cache", "before_script", "after_script"}
VERIFY_JOBS = ["be:test", "fe:test", "fe:build", "fe:bundle-check"]
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


def first_match(rules: list, variables: dict):
    for rule in rules:
        if "if" in rule and not evaluate(rule["if"], variables):
            continue  # changes만 있는 규칙은 맞는 것으로 본다(보수적)
        return rule.get("when", "on_success")
    return None


def pipeline(variables: dict) -> dict[str, str]:
    """{잡 이름: when}. 파이프라인이 만들어지지 않으면 빈 사전이다."""
    if first_match(CI["workflow"]["rules"], variables) in (None, "never"):
        return {}
    out: dict[str, str] = {}
    for name in job_names():
        job = effective(name)
        when = first_match(job["rules"], variables) if "rules" in job else "on_success"
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
    def test_the_nine_jobs_exist(self):
        for name in NEW_JOBS:
            self.assertIn(name, CI, name)

    def test_deploy_stage_jobs_use_the_deploy_runner_and_the_rest_use_verify(self):
        for name in job_names():
            tags = effective(name).get("tags")
            if name in DEPLOY_TAGGED:
                self.assertEqual(tags, ["deploy"], name)
            else:
                self.assertEqual(tags, ["verify"], name)

    def test_stages(self):
        want = {"be:test": "verify", "fe:test": "verify", "fe:build": "verify", "fe:bundle-check": "verify",
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

    def test_switch_default_is_off(self):
        self.assertEqual(CI["variables"]["FIT_CD_ENABLED"], "false")

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
        self.assertIn("be/build/libs/*.jar", effective("be:test")["artifacts"]["paths"])
        self.assertIn("fe-bundle/", effective("fe:build")["artifacts"]["paths"])
        build_needs = effective("build:images")["needs"]
        self.assertIn({"job": "be:test", "artifacts": True}, build_needs)
        self.assertIn({"job": "fe:build", "artifacts": True}, build_needs)
        self.assertIn("fe:bundle-check", build_needs)
        self.assertIn({"job": "fe:build", "artifacts": True}, effective("fe:bundle-check")["needs"])

    def test_scripts_pass_the_commit_sha(self):
        self.assertIn('DEPLOYMENT_VERSION="$CI_COMMIT_SHA" pnpm build', script_text("fe:build"))
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
        script = effective("be:test")["script"]
        self.assertTrue(any(line.startswith("sh ./gradlew") or line.startswith("sh gradlew") for line in script), script)
        self.assertFalse(any(line.startswith("./gradlew") for line in script), script)

    def test_be_tests_get_a_database_like_the_one_dev_runs(self):
        # ApiApplicationTests.contextLoads는 JPA가 DB에 붙어야 뜬다(2026-10-23 DB 없이 돌려 165개 중 이 하나가 실패했다)
        job = effective("be:test")
        self.assertEqual(job["services"], [{"name": "$PGVECTOR_IMAGE", "alias": "postgres"}])
        v = job["variables"]
        self.assertEqual(v["SPRING_DATASOURCE_URL"], f"jdbc:postgresql://postgres:5432/{v['POSTGRES_DB']}")
        self.assertEqual(v["SPRING_DATASOURCE_USERNAME"], v["POSTGRES_USER"])
        self.assertEqual(v["SPRING_DATASOURCE_PASSWORD"], v["POSTGRES_PASSWORD"])

    def test_fe_generates_next_types_before_type_checking(self):
        # Next 16의 LayoutProps 같은 전역 타입은 typegen이나 build가 만든다. 먼저 만들지 않으면 tsc가 실패한다
        lines = effective("fe:test")["script"]
        typegen = next(i for i, l in enumerate(lines) if "next typegen" in l)
        tsc = next(i for i, l in enumerate(lines) if "tsc --noEmit" in l)
        self.assertLess(typegen, tsc)

    def test_lint_guards_installs_pyyaml_for_this_file(self):
        self.assertIn("py3-yaml", "\n".join(effective("lint:guards")["before_script"]))


class PipelineContentsTest(unittest.TestCase):
    def new_jobs(self, kind, switch=None):
        return {n: w for n, w in pipeline(context(kind, switch)).items() if n in NEW_JOBS}

    def test_with_the_switch_off_only_the_tests_appear_everywhere(self):
        for kind in ("develop", "master", "mr"):
            self.assertEqual(sorted(self.new_jobs(kind)), ["be:test", "fe:test"], kind)

    def test_no_pipeline_for_a_plain_branch_push_or_a_develop_to_master_mr(self):
        for kind in ("feature-push", "mr-from-develop"):
            for switch in (None, "true"):
                self.assertEqual(pipeline(context(kind, switch)), {}, kind)

    def test_switch_on_develop_runs_everything_up_to_dev_smoke(self):
        jobs = self.new_jobs("develop", "true")
        self.assertEqual(sorted(jobs), sorted(VERIFY_JOBS + ["build:images", "deploy:dev", "smoke:dev"]))
        self.assertEqual(jobs["deploy:dev"], "on_success")

    def test_switch_on_master_waits_for_a_person_before_prod(self):
        jobs = self.new_jobs("master", "true")
        self.assertEqual(sorted(jobs), sorted(VERIFY_JOBS + ["build:images", "deploy:prod", "smoke:prod"]))
        self.assertEqual(jobs["deploy:prod"], "manual")

    def test_switch_on_mr_runs_only_the_verify_jobs(self):
        self.assertEqual(sorted(self.new_jobs("mr", "true")), sorted(VERIFY_JOBS))

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


if __name__ == "__main__":
    unittest.main()
