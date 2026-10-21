from jobbuddy_workers.__main__ import main


def test_help_without_command_exits_ok(capsys):
    assert main([]) == 0
    assert "fetch" in capsys.readouterr().out


def test_unbuilt_command_fails():
    assert main(["match"]) == 1
