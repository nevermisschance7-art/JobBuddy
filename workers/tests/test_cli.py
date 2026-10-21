from jobbuddy_workers.__main__ import main


def test_help_without_command_exits_ok(capsys):
    assert main([]) == 0
    assert "fetch" in capsys.readouterr().out


def test_commands_are_registered(capsys):
    main([])
    out = capsys.readouterr().out
    for cmd in ("fetch", "match", "discover", "seed-companies"):
        assert cmd in out
